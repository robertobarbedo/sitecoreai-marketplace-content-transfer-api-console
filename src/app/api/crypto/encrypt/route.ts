import { NextResponse } from "next/server";
import { auditLog } from "@/src/lib/marketplace-auth/audit-log";
import { isValidHost } from "@/src/lib/transfer/client";
import {
  SecretDecryptionError,
  isEncryptionConfigured,
  sealForConnection,
} from "@/src/lib/transfer/crypto";
import { readOrganizationId } from "@/src/lib/transfer/org";
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
 * connection and the caller's verified organization. Plaintext is encrypted;
 * current values are returned unchanged once verified to belong to the
 * organization + connection; older ciphertext is refused. Fails with
 * encryption_error when no key is configured.
 */
export async function POST(request: Request) {
  // Set by the middleware from the verified token, never by the browser.
  const organizationId = readOrganizationId(request);
  if (!organizationId) {
    return jsonError("validation", 403, {
      detail: "The organization of the caller is unknown",
    });
  }

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

  // Audit lines carry the event, outcome, host and organization only —
  // never the secret, the ciphertext or the client ID.
  try {
    const value = sealForConnection(secret, { organizationId, host, clientId });
    auditLog(request, {
      event: "secret.encrypt",
      outcome: "allow",
      status: 200,
      org: organizationId,
      host,
    });
    return NextResponse.json({ value });
  } catch (error) {
    auditLog(request, {
      event: "secret.encrypt",
      outcome: "error",
      status: 500,
      org: organizationId,
      host,
      reason:
        error instanceof SecretDecryptionError
          ? "encryption_error"
          : "unexpected_error",
    });
    if (error instanceof SecretDecryptionError) {
      return jsonError("encryption_error", 500, { detail: error.message });
    }
    throw error;
  }
}
