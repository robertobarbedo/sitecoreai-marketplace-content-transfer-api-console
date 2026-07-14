import type { ClientSDK } from "@sitecore-marketplace-sdk/client";
import type { PublishMode } from "@/src/types/transfer";

/**
 * Post-transfer publishing for the Saved Transfers tab, adapted from the
 * sitecoreai-marketplace-publishing-center reference app. Publishes run over
 * the Marketplace SDK's authoring GraphQL against the destination's resolved
 * SitecoreAI environment (its sitecoreContextId) — not the stored REST
 * connections. Invariants: publishSubItems is always true, related items are
 * never published, and the target database is always "experienceedge".
 */

/** One fired publishItem mutation (one per published root path). */
export interface PublishRequestRow {
  path: string;
  /** null = the mutation failed; see error. */
  operationId: string | null;
  error?: string;
}

/** A Sitecore publishing job as reported by the authoring jobs query. */
export interface PublishJobInfo {
  handle: string;
  name: string;
  /** Queued | Running | Finished | Failed (open set). */
  jobState: string | null;
  processed: number | null;
  done: boolean;
}

export interface WatchPublishJobsResult {
  jobs: PublishJobInfo[];
  /** False when no new publishing job could be identified before giving up. */
  identified: boolean;
  timedOut: boolean;
}

function escapeGraphQL(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

async function runAuthoring<T>(
  client: ClientSDK,
  sitecoreContextId: string,
  query: string,
): Promise<T> {
  const response = await client.mutate("xmc.authoring.graphql", {
    params: {
      query: { sitecoreContextId },
      body: { query },
    },
  });

  const payload = (
    response as Record<string, unknown> & {
      data?: { data?: T; errors?: { message?: string }[] };
    }
  ).data;

  if (payload?.errors?.length) {
    throw new Error(
      payload.errors.map((e) => e.message ?? "Unknown GraphQL error").join("; "),
    );
  }
  if (payload?.data === undefined || payload?.data === null) {
    throw new Error("Empty GraphQL response");
  }
  return payload.data;
}

/**
 * Lists the installed language codes of the environment. Throws on failure —
 * the caller decides the fallback (publishing "en" only, with a warning).
 */
export async function getEnvironmentLanguages(
  client: ClientSDK,
  sitecoreContextId: string,
): Promise<string[]> {
  const data = await runAuthoring<{
    languages: { nodes: { name: string }[] } | null;
  }>(
    client,
    sitecoreContextId,
    `
      query {
        languages {
          nodes { name }
        }
      }
    `,
  );
  return (data.languages?.nodes ?? [])
    .map((l) => l.name)
    .filter((name) => name !== "");
}

/**
 * Fires one publishItem mutation for the given root path and returns the
 * operationId. Throws when the mutation is rejected.
 */
export async function startPublish(
  client: ClientSDK,
  sitecoreContextId: string,
  opts: {
    rootItemPath: string;
    mode: PublishMode;
    languages: string[];
    displayName: string;
  },
): Promise<string | null> {
  const langList = opts.languages
    .map((l) => `"${escapeGraphQL(l)}"`)
    .join(", ");
  const data = await runAuthoring<{
    publishItem: { operationId?: string } | null;
  }>(
    client,
    sitecoreContextId,
    `
      mutation {
        publishItem(input: {
          rootItemPath: "${escapeGraphQL(opts.rootItemPath)}"
          languages: [${langList}]
          targetDatabases: "experienceedge"
          publishItemMode: ${opts.mode}
          publishRelatedItems: false
          publishSubItems: true
          displayName: "${escapeGraphQL(opts.displayName)}"
        }) {
          operationId
        }
      }
    `,
  );
  return data.publishItem?.operationId ?? null;
}

/** Snapshot of the environment's publishing jobs ("Publish*" by name). */
export async function fetchPublishJobs(
  client: ClientSDK,
  sitecoreContextId: string,
): Promise<PublishJobInfo[]> {
  const data = await runAuthoring<{
    jobs: { nodes: PublishJobInfo[] } | null;
  }>(
    client,
    sitecoreContextId,
    `
      query {
        jobs(input: { jobName: "Publish*" }) {
          nodes {
            name
            handle
            status {
              processed
              jobState
            }
            done
          }
        }
      }
    `,
  );
  type RawJob = {
    name?: string;
    handle?: string;
    status?: { processed?: number | null; jobState?: string | null };
    done?: boolean;
  };
  return ((data.jobs?.nodes ?? []) as RawJob[]).map((job, index) => ({
    handle: job.handle ?? String(index),
    name: job.name ?? "Publish",
    jobState: job.status?.jobState ?? null,
    processed: job.status?.processed ?? null,
    done: job.done ?? false,
  }));
}

const JOB_POLL_MS = 5_000;
const JOB_TIMEOUT_MS = 10 * 60_000;
/** Polls without any new job before concluding "queued, can't observe it". */
const JOB_IDENTIFY_POLLS = 6;

function isJobDone(job: PublishJobInfo): boolean {
  return (
    job.done ||
    job.jobState === "Finished" ||
    job.jobState === "Failed"
  );
}

/**
 * Polls the publishing jobs until every job that appeared after `baseline`
 * finishes (or fails). Publishing runs server-side, so this only observes:
 * when no new job can be identified in time, it resolves as not-identified
 * instead of failing — the publish was still queued.
 */
export async function watchPublishJobs(
  client: ClientSDK,
  sitecoreContextId: string,
  baseline: Set<string>,
  expectedCount: number,
  onUpdate: (jobs: PublishJobInfo[]) => void,
  shouldContinue: () => boolean,
): Promise<WatchPublishJobsResult> {
  const startedAt = Date.now();
  let known: PublishJobInfo[] = [];
  let pollsWithoutNews = 0;

  while (shouldContinue()) {
    if (Date.now() - startedAt > JOB_TIMEOUT_MS) {
      return { jobs: known, identified: known.length > 0, timedOut: true };
    }
    await new Promise((resolve) => setTimeout(resolve, JOB_POLL_MS));
    if (!shouldContinue()) break;

    let snapshot: PublishJobInfo[];
    try {
      snapshot = await fetchPublishJobs(client, sitecoreContextId);
    } catch {
      // Transient polling failures must not fail the publish step.
      continue;
    }
    const ours = snapshot.filter((job) => !baseline.has(job.handle));
    const changed =
      ours.length !== known.length ||
      ours.some((job) => {
        const prev = known.find((k) => k.handle === job.handle);
        return !prev || prev.jobState !== job.jobState || prev.done !== job.done;
      });
    known = ours;
    onUpdate([...known]);
    pollsWithoutNews = changed ? 0 : pollsWithoutNews + 1;

    if (known.length === 0) {
      if (pollsWithoutNews >= JOB_IDENTIFY_POLLS) {
        return { jobs: [], identified: false, timedOut: false };
      }
      continue;
    }
    if (known.every(isJobDone)) {
      // Sequential publishes may surface their jobs one by one — once the
      // expected number is visible (or nothing new showed up for a couple of
      // polls) the run is complete.
      if (known.length >= expectedCount || pollsWithoutNews >= 2) {
        return { jobs: known, identified: true, timedOut: false };
      }
    }
  }
  return { jobs: known, identified: known.length > 0, timedOut: false };
}
