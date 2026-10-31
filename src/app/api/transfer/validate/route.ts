import { NextResponse } from "next/server";
import { CONTENT_TRANSFER_BASE, transferFetch } from "@/src/lib/transfer/client";
import {
  auditUpstream,
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
    const response = await transferFetch(
      env,
      `${CONTENT_TRANSFER_BASE}/transfers/${NIL_UUID}/status`,
      { method: "GET" },
    );
    // Any non-auth answer (e.g. 404 for the nil id) means the token exchange
    // and the host accepted the credentials, so it is logged as allowed.
    auditUpstream(request, "connection.validate", env.host, {
      upstreamStatus: response.status,
      ok: true,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    auditUpstream(request, "connection.validate", env.host, { error });
    return transferErrorResponse(error);
  }
}
