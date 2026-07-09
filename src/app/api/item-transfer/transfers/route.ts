import { ITEM_TRANSFER_BASE } from "@/src/lib/transfer/client";
import { pagingQuery, proxyJsonRequest } from "@/src/lib/transfer/request";

/**
 * Returns the paged list of active and completed item transfers across all
 * databases. Runs against the DESTINATION environment.
 */
export async function GET(request: Request) {
  return proxyJsonRequest(
    request,
    `${ITEM_TRANSFER_BASE}/transfers${pagingQuery(request)}`,
    { method: "GET" },
  );
}
