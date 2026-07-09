import { ITEM_TRANSFER_BASE } from "@/src/lib/transfer/client";
import { pagingQuery, proxyJsonRequest } from "@/src/lib/transfer/request";

/**
 * Returns the paginated list of .raif blob sources available in Azure Blob
 * Storage. Runs against the DESTINATION environment.
 */
export async function GET(request: Request) {
  return proxyJsonRequest(
    request,
    `${ITEM_TRANSFER_BASE}/sources/blobs${pagingQuery(request)}`,
    { method: "GET" },
  );
}
