import { ITEM_TRANSFER_BASE } from "@/src/lib/transfer/client";
import { proxyJsonRequest } from "@/src/lib/transfer/request";

/**
 * GET: retrieves the current upload / processing state of a blob source.
 * DELETE: permanently discards the blob and its cached artifacts.
 * Both run against the DESTINATION environment.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ blobName: string }> },
) {
  const { blobName } = await params;
  return proxyJsonRequest(
    request,
    `${ITEM_TRANSFER_BASE}/sources/blobs/${encodeURIComponent(blobName)}`,
    { method: "GET" },
  );
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ blobName: string }> },
) {
  const { blobName } = await params;
  return proxyJsonRequest(
    request,
    `${ITEM_TRANSFER_BASE}/sources/blobs/${encodeURIComponent(blobName)}`,
    { method: "DELETE" },
  );
}
