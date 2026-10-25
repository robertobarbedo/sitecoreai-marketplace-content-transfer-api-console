import { ITEM_TRANSFER_BASE } from "@/src/lib/transfer/client";
import { pagingQuery, proxyJsonRequest } from "@/src/lib/transfer/request";

/**
 * Returns the paginated list of transferred items for a database + source.
 * Runs against the DESTINATION environment.
 */
export async function GET(
  request: Request,
  {
    params,
  }: { params: Promise<{ databaseName: string; sourceName: string }> },
) {
  const { databaseName, sourceName } = await params;
  return proxyJsonRequest(
    request,
    `${ITEM_TRANSFER_BASE}/transfers/databases/${encodeURIComponent(databaseName)}/sources/${encodeURIComponent(sourceName)}/items${pagingQuery(request)}`,
    { method: "GET" },
  );
}
