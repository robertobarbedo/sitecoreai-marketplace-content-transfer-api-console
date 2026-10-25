import { ITEM_TRANSFER_BASE } from "@/src/lib/transfer/client";
import { pagingQuery, proxyJsonRequest } from "@/src/lib/transfer/request";

/**
 * Returns the paginated history of consumed sources (state transition
 * timelines, newest first). Runs against the DESTINATION environment.
 */
export async function GET(request: Request) {
  return proxyJsonRequest(
    request,
    `${ITEM_TRANSFER_BASE}/history${pagingQuery(request)}`,
    { method: "GET" },
  );
}
