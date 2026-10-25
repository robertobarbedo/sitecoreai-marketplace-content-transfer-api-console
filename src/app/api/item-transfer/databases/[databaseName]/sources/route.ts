import { NextResponse } from "next/server";
import {
  ITEM_TRANSFER_BASE,
  TransferApiRequestError,
  transferFetch,
} from "@/src/lib/transfer/client";
import {
  readEnvironment,
  missingCredentialsResponse,
  jsonError,
  transferErrorResponse,
} from "@/src/lib/transfer/request";
import type { StartItemTransferResult } from "@/src/types/transfer";

/**
 * Starts consuming a blob (or file) source into the target database. The
 * upstream responds 202 with a `location` header whose final path segment is
 * the source name used by all follow-up endpoints; both are surfaced in the
 * JSON body. Runs against the DESTINATION environment.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ databaseName: string }> },
) {
  const env = readEnvironment(request);
  if (!env) {
    return missingCredentialsResponse();
  }

  const { databaseName } = await params;
  const incoming = new URL(request.url).searchParams;
  const blobName = incoming.get("blobName");
  const fileName = incoming.get("fileName");

  if ((!blobName && !fileName) || (blobName && fileName)) {
    return jsonError("validation", 400, {
      detail: "Provide exactly one of blobName or fileName",
    });
  }

  const query = new URLSearchParams();
  if (blobName) query.set("blobName", blobName);
  if (fileName) query.set("fileName", fileName);

  try {
    const response = await transferFetch(
      env,
      `${ITEM_TRANSFER_BASE}/transfers/databases/${encodeURIComponent(databaseName)}/sources?${query.toString()}`,
      { method: "POST" },
    );
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new TransferApiRequestError(response.status, detail);
    }

    const location = response.headers.get("location");
    const sourceName = location
      ? decodeURIComponent(location.split("/").filter(Boolean).pop() ?? "")
      : (blobName ?? fileName);

    const result: StartItemTransferResult = {
      location,
      sourceName: sourceName || null,
    };
    return NextResponse.json(result, { status: 202 });
  } catch (error) {
    return transferErrorResponse(error);
  }
}
