import { CONTENT_TRANSFER_BASE } from "@/src/lib/transfer/client";
import { proxyJsonRequest } from "@/src/lib/transfer/request";

/**
 * Deletes a content transfer operation and cleans up its resources.
 * Runs against the SOURCE environment.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ transferId: string }> },
) {
  const { transferId } = await params;
  return proxyJsonRequest(
    request,
    `${CONTENT_TRANSFER_BASE}/transfers/${encodeURIComponent(transferId)}`,
    { method: "DELETE" },
  );
}
