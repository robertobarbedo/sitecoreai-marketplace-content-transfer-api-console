import { NextResponse } from "next/server";
import {
  CONTENT_TRANSFER_BASE,
  TransferApiRequestError,
  transferFetch,
} from "@/src/lib/transfer/client";
import {
  readSourceEnvironment,
  readDestinationEnvironment,
  missingCredentialsResponse,
  jsonError,
  transferErrorResponse,
} from "@/src/lib/transfer/request";
import type { ChunkCopyResult } from "@/src/types/transfer";

// Chunk payloads are binary and can take a while to move; opt out of any
// static optimization and allow the longest duration the host permits.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Reads a parameter from the Content-Disposition header of the chunk
 * retrieval response, e.g. `ItemsProcessed=12; ItemsSkipped=0; IsMedia=true`.
 */
function readDispositionParam(
  disposition: string | null,
  name: string,
): string | null {
  if (!disposition) return null;
  const match = disposition.match(
    new RegExp(`${name}\\s*=\\s*"?([^";]+)"?`, "i"),
  );
  return match ? match[1].trim() : null;
}

/**
 * Copies one chunk from the SOURCE environment to the DESTINATION
 * environment: GET the binary stream from the source, then PUT the identical
 * bytes to the destination (`isMedia` forwarded from the retrieval response,
 * as the Save endpoint requires). The payload is never altered — media stays
 * compressed, content stays encrypted — and it never reaches the browser.
 */
export async function POST(
  request: Request,
  {
    params,
  }: {
    params: Promise<{ transferId: string; chunksetId: string; chunkId: string }>;
  },
) {
  const source = readSourceEnvironment(request);
  if (!source) {
    return missingCredentialsResponse("source");
  }
  const destination = readDestinationEnvironment(request);
  if (!destination) {
    return missingCredentialsResponse("destination");
  }

  const { transferId, chunksetId, chunkId } = await params;
  const chunkIdNumber = Number(chunkId);
  if (!Number.isInteger(chunkIdNumber) || chunkIdNumber < 0) {
    return jsonError("validation", 400, {
      field: "chunkId",
      detail: "chunkId must be a non-negative integer",
    });
  }

  const chunkPath = `${CONTENT_TRANSFER_BASE}/transfers/${encodeURIComponent(transferId)}/chunksets/${encodeURIComponent(chunksetId)}/chunks/${chunkIdNumber}`;

  try {
    // 1. Retrieve the chunk from the source environment.
    const getResponse = await transferFetch(source, chunkPath, {
      method: "GET",
      headers: { Accept: "application/octet-stream" },
    });
    if (!getResponse.ok) {
      const detail = await getResponse.text().catch(() => "");
      throw new TransferApiRequestError(getResponse.status, detail);
    }

    const disposition = getResponse.headers.get("content-disposition");
    const isMedia =
      readDispositionParam(disposition, "IsMedia")?.toLowerCase() === "true";
    const itemsProcessed = Number(
      readDispositionParam(disposition, "ItemsProcessed") ?? 0,
    );
    const itemsSkipped = Number(
      readDispositionParam(disposition, "ItemsSkipped") ?? 0,
    );

    // Buffered (not streamed) so the PUT body is retry-safe if the
    // destination token needs a refresh. Chunk sizes are bounded by design.
    const payload = await getResponse.arrayBuffer();

    // 2. Save the identical bytes to the destination environment.
    const putResponse = await transferFetch(
      destination,
      `${chunkPath}?isMedia=${isMedia}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream" },
        body: payload,
      },
    );
    if (!putResponse.ok) {
      const detail = await putResponse.text().catch(() => "");
      throw new TransferApiRequestError(putResponse.status, detail);
    }

    const result: ChunkCopyResult = {
      chunkId: chunkIdNumber,
      isMedia,
      itemsProcessed: Number.isNaN(itemsProcessed) ? 0 : itemsProcessed,
      itemsSkipped: Number.isNaN(itemsSkipped) ? 0 : itemsSkipped,
      bytes: payload.byteLength,
    };
    return NextResponse.json(result);
  } catch (error) {
    return transferErrorResponse(error);
  }
}
