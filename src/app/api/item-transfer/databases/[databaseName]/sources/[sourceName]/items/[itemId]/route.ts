import { ITEM_TRANSFER_BASE } from "@/src/lib/transfer/client";
import { proxyJsonRequest } from "@/src/lib/transfer/request";

/**
 * Retrieves the captured metadata and localized/versioned field information
 * of one transferred item. Runs against the DESTINATION environment.
 */
export async function GET(
  request: Request,
  {
    params,
  }: {
    params: Promise<{
      databaseName: string;
      sourceName: string;
      itemId: string;
    }>;
  },
) {
  const { databaseName, sourceName, itemId } = await params;
  return proxyJsonRequest(
    request,
    `${ITEM_TRANSFER_BASE}/transfers/databases/${encodeURIComponent(databaseName)}/sources/${encodeURIComponent(sourceName)}/items/${encodeURIComponent(itemId)}`,
    { method: "GET" },
  );
}
