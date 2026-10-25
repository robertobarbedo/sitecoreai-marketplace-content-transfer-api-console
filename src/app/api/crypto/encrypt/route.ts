import { NextResponse } from "next/server";
import { isValidHost } from "@/src/lib/transfer/client";
import {
  SecretDecryptionError,
  isEncryptionConfigured,
  sealForConnection,
} from "@/src/lib/transfer/crypto";
import { jsonError } from "@/src/lib/transfer/request";

/**
 * Encrypt-only endpoint used when saving connections (and to migrate older
 * stored values on load). There is deliberately NO decrypt counterpart —
 * decryption happens exclusively inside the proxy before the token exchange,
 * so ciphertext read from the content tree can never be turned back into
 * plaintext through a public route. This route never returns plaintext.
 */

/** Reports whether an encryption key is configured on the server. */
export async function GET() {
  return NextResponse.json({ configured: isEncryptionConfigured() });
}

/**
 * POST { secret, host, clientId } → { value }: the secret encrypted for that
 * connection. Plaintext and older-format values are (re-)encrypted; current
 * values are returned unchanged once verified to belong to the connection.
 * Fails with encryption_error when no key is configured.
 */
export async function POST(request: Request) {
  let body: { secret?: string; host?: string; clientId?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError("validation", 400, { detail: "Invalid JSON body" });
  }

  const { secret, clientId } = body;
  const host = body.host?.trim().toLowerCase();
  if (typeof secret !== "string" || secret === "") {
    return jsonError("validation", 400, {
      field: "secret",
      detail: "secret is required",
    });
  }
  if (!host || !isValidHost(host)) {
    return jsonError("validation", 400, {
      field: "host",
      detail: "host must be a sitecorecloud.io host name",
    });
  }
  if (typeof clientId !== "string" || clientId === "") {
    return jsonError("validation", 400, {
      field: "clientId",
      detail: "clientId is required",
    });
  }

  try {
    return NextResponse.json({
      value: sealForConnection(secret, { host, clientId }),
    });
  } catch (error) {
    if (error instanceof SecretDecryptionError) {
      return jsonError("encryption_error", 500, { detail: error.message });
    }
    throw error;
  }
}
