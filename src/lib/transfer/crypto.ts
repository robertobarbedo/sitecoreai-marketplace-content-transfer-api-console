import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

/**
 * At-rest encryption for stored client secrets (AES-256-GCM).
 *
 * The key comes from the CT_ENCRYPTION_KEY environment variable (32 bytes,
 * base64 — generate with `openssl rand -base64 32`), set as a Vercel env var
 * in production and in .env.local for development.
 *
 * Security invariant: decryption is NEVER exposed through an HTTP endpoint.
 * Secrets are encrypted once (at save time, via the encrypt-only route) and
 * decrypted exclusively inside the server-side proxy right before the OAuth
 * token exchange. The browser and the content tree only ever hold ciphertext.
 */

const PREFIX = "enc:v1:";

export class SecretDecryptionError extends Error {
  constructor(detail?: string) {
    super(detail ?? "The stored secret could not be decrypted");
    this.name = "SecretDecryptionError";
  }
}

function loadKey(): Buffer | null {
  const raw = process.env.CT_ENCRYPTION_KEY;
  if (!raw) return null;
  try {
    const key = Buffer.from(raw.trim(), "base64");
    return key.length === 32 ? key : null;
  } catch {
    return null;
  }
}

export function isEncryptionConfigured(): boolean {
  return loadKey() !== null;
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX);
}

/**
 * Encrypts a plaintext secret to `enc:v1:<iv>:<tag>:<data>` (base64 parts).
 * Throws if the encryption key is not configured — callers decide whether to
 * fall back to plaintext.
 */
export function encryptSecret(plain: string): string {
  const key = loadKey();
  if (!key) {
    throw new Error("CT_ENCRYPTION_KEY is not configured");
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${data.toString("base64")}`;
}

/**
 * Decrypts an `enc:v1:` value; non-prefixed values (legacy plaintext
 * connections) pass through unchanged. Throws SecretDecryptionError when the
 * key is missing/wrong or the ciphertext is malformed/tampered.
 */
export function decryptSecret(value: string): string {
  if (!isEncrypted(value)) {
    return value;
  }

  const key = loadKey();
  if (!key) {
    throw new SecretDecryptionError(
      "CT_ENCRYPTION_KEY is not configured on the server",
    );
  }

  const parts = value.slice(PREFIX.length).split(":");
  if (parts.length !== 3) {
    throw new SecretDecryptionError("Malformed encrypted secret");
  }

  try {
    const [iv, tag, data] = parts.map((part) => Buffer.from(part, "base64"));
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString(
      "utf8",
    );
  } catch {
    throw new SecretDecryptionError(
      "The stored secret could not be decrypted — was the encryption key changed?",
    );
  }
}
