/**
 * Security audit log: one JSON line per event on stdout. The host collects
 * stdout as runtime logs and a log drain forwards them to the log store.
 *
 *   auditLog(request, { event: "secret.encrypt", outcome: "allow", sub });
 *
 * Timestamps are UTC (ISO 8601). Never pass tokens, secrets, API keys or
 * content values: log who did what, not the data.
 */

export type AuditOutcome = "allow" | "deny" | "error";

export interface AuditEvent {
  /** Dotted event name, e.g. "auth", "secret.encrypt", "transfer.start" */
  event: string;
  outcome: AuditOutcome;
  /** HTTP status returned to the caller, when there is one */
  status?: number;
  /** Auth0 subject of the caller */
  sub?: string;
  /** Sitecore Cloud organization of the caller */
  org?: string | null;
  /** Why a request was denied or failed */
  reason?: string;
  [key: string]: unknown;
}

export function auditLog(request: Request | null, event: AuditEvent): void {
  let path: string | undefined;
  if (request) {
    try {
      path = new URL(request.url).pathname;
    } catch {
      // Keep logging even if the URL can't be parsed
    }
  }
  console.info(
    JSON.stringify({
      ts: new Date().toISOString(),
      type: "audit",
      method: request?.method,
      path,
      ...event,
    }),
  );
}
