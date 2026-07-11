import { NextResponse } from "next/server";
import {
  encryptSecret,
  isEncrypted,
  isEncryptionConfigured,
} from "@/src/lib/transfer/crypto";
import { jsonError } from "@/src/lib/transfer/request";

/**
 * Encrypt-only endpoint used when saving connections. There is deliberately
 * NO decrypt counterpart — decryption happens exclusively inside the proxy
 * before the token exchange, so ciphertext read from the content tree can
 * never be turned back into plaintext through a public route.
 */

/** Reports whether an encryption key is configured on the server. */
export async function GET() {
  return NextResponse.json({ configured: isEncryptionConfigured() });
}

/**
 * POST { secret } → { value, encrypted }. When the key is missing the secret
 * is returned as-is with encrypted:false so the caller can warn the user
 * (fallback-with-warning behavior).
 */
export async function POST(request: Request) {
  let body: { secret?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError("validation", 400, { detail: "Invalid JSON body" });
  }

  const secret = body.secret;
  if (typeof secret !== "string" || secret === "") {
    return jsonError("validation", 400, {
      field: "secret",
      detail: "secret is required",
    });
  }

  // Already-encrypted values pass through untouched (idempotent saves).
  if (isEncrypted(secret)) {
    return NextResponse.json({ value: secret, encrypted: true });
  }

  if (!isEncryptionConfigured()) {
    return NextResponse.json({ value: secret, encrypted: false });
  }

  return NextResponse.json({ value: encryptSecret(secret), encrypted: true });
}
