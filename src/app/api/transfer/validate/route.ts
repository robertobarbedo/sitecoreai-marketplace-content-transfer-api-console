import { NextResponse } from "next/server";
import { CONTENT_TRANSFER_BASE, transferFetch } from "@/src/lib/transfer/client";
import {
  readEnvironment,
  missingCredentialsResponse,
  transferErrorResponse,
} from "@/src/lib/transfer/request";

const NIL_UUID = "00000000-0000-0000-0000-000000000000";

/**
 * Validates an environment connection (host + automation client credentials)
 * by exchanging the credentials for a token and calling the transfer status
 * endpoint with a nil UUID. Any upstream answer other than an auth failure
 * proves the host is reachable and the credentials are accepted.
 */
export async function POST(request: Request) {
  const env = readEnvironment(request);
  if (!env) {
    return missingCredentialsResponse();
  }

  try {
    await transferFetch(
      env,
      `${CONTENT_TRANSFER_BASE}/transfers/${NIL_UUID}/status`,
      { method: "GET" },
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return transferErrorResponse(error);
  }
}
