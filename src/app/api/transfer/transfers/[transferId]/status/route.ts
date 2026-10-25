import { CONTENT_TRANSFER_BASE } from "@/src/lib/transfer/client";
import { proxyJsonRequest } from "@/src/lib/transfer/request";

/**
 * Retrieves the status and chunk-set metadata of a content transfer
 * operation. Runs against the SOURCE environment.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ transferId: string }> },
) {
  const { transferId } = await params;
  return proxyJsonRequest(
    request,
    `${CONTENT_TRANSFER_BASE}/transfers/${encodeURIComponent(transferId)}/status`,
    { method: "GET" },
  );
}
