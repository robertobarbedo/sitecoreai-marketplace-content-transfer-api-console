import { ITEM_TRANSFER_BASE } from "@/src/lib/transfer/client";
import { proxyJsonRequest } from "@/src/lib/transfer/request";

/**
 * Retrieves the detailed metrics of a transferred source (item counts,
 * state, validation errors). Runs against the DESTINATION environment.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ transferId: string }> },
) {
  const { transferId } = await params;
  return proxyJsonRequest(
    request,
    `${ITEM_TRANSFER_BASE}/transfers/${encodeURIComponent(transferId)}`,
    { method: "GET" },
  );
}
