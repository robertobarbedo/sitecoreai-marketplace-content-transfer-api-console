import { CONTENT_TRANSFER_BASE } from "@/src/lib/transfer/client";
import { proxyJsonRequest } from "@/src/lib/transfer/request";

/**
 * Completes a chunk set, generating a .raif file on the destination
 * environment. Runs against the DESTINATION environment.
 */
export async function POST(
  request: Request,
  {
    params,
  }: { params: Promise<{ transferId: string; chunksetId: string }> },
) {
  const { transferId, chunksetId } = await params;
  return proxyJsonRequest(
    request,
    `${CONTENT_TRANSFER_BASE}/transfers/${encodeURIComponent(transferId)}/chunksets/${encodeURIComponent(chunksetId)}/complete`,
    { method: "POST" },
  );
}
