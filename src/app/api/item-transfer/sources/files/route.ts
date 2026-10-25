import { ITEM_TRANSFER_BASE } from "@/src/lib/transfer/client";
import { pagingQuery, proxyJsonRequest } from "@/src/lib/transfer/request";

/**
 * Returns the file sources natively accessible by SitecoreAI CMS.
 * Runs against the DESTINATION environment.
 */
export async function GET(request: Request) {
  return proxyJsonRequest(
    request,
    `${ITEM_TRANSFER_BASE}/sources/files${pagingQuery(request)}`,
    { method: "GET" },
  );
}
