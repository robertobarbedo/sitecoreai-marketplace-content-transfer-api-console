import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

/**
 * At-rest encryption for stored client secrets (AES-256-GCM).
 *
 * The key comes from the CT_ENCRYPTION_KEY environment variable (32 bytes,
 * base64 — generate with `openssl rand -base64 32`), set as a Vercel env var
 * in production and in .env.local for development. It is required: without
 * it the app refuses to store or use secrets rather than keeping plaintext.
 *
 * Each secret is bound to its owner and connection: `orgId|host|clientId` is
 * the GCM additional authenticated data, where orgId is the caller's verified
 * Sitecore Cloud organization (src/middleware.ts). A ciphertext copied to
 * another organization, host or client ID fails to decrypt.
 *
 * Security invariant: decryption is NEVER exposed through an HTTP endpoint.
 * Secrets are encrypted once (at save time, via the encrypt-only route) and
 * decrypted exclusively inside the server-side proxy right before the OAuth
 * token exchange. The browser and the content tree only ever hold ciphertext.
 */

/** Mirrored in src/utils/transfer-api.ts. */
const PREFIX = "enc:v3:";

/**
 * Older formats (v1 unbound, v2 bound to host + client ID only). They are
 * NOT migrated: re-sealing one would let a user of any organization adopt a
 * copied ciphertext, so their secrets must be entered again.
 */
const LEGACY_PREFIXES = ["enc:v1:", "enc:v2:"];

export class SecretDecryptionError extends Error {
  constructor(detail?: string) {
    super(detail ?? "The stored secret could not be decrypted");
    this.name = "SecretDecryptionError";
  }
}

/** The organization and connection a secret belongs to. */
export interface SecretBinding {
  organizationId: string;
  host: string;
  clientId: string;
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

function requireKey(): Buffer {
  const key = loadKey();
  if (!key) {
    throw new SecretDecryptionError(
      "CT_ENCRYPTION_KEY is not configured on the server",
    );
  }
  return key;
}

function bindingData({ organizationId, host, clientId }: SecretBinding): Buffer {
  return Buffer.from(
    `${organizationId}|${host.toLowerCase()}|${clientId}`,
    "utf8",
  );
}

export function isEncryptionConfigured(): boolean {
  return loadKey() !== null;
}

/** True for values in the current, organization-bound format. */
export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX);
}

/**
 * Encrypts a plaintext secret for one organization + connection to
 * `enc:v3:<iv>:<tag>:<data>` (base64 parts). Throws SecretDecryptionError if
 * the encryption key is not configured.
 */
export function encryptSecret(plain: string, binding: SecretBinding): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", requireKey(), iv);
  cipher.setAAD(bindingData(binding));
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${data.toString("base64")}`;
}

function decryptParts(body: string, aad: Buffer): string {
  const key = requireKey();
  const parts = body.split(":");
  if (parts.length !== 3) {
    throw new SecretDecryptionError("Malformed encrypted secret");
  }

  try {
    const [iv, tag, data] = parts.map((part) => Buffer.from(part, "base64"));
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString(
      "utf8",
    );
  } catch {
    throw new SecretDecryptionError(
      "The stored secret could not be decrypted — was the encryption key changed, the host / client ID edited, or the secret saved by another organization? Enter the secret again.",
    );
  }
}

/**
 * Decrypts an `enc:v3:` value for the organization + connection it was
 * sealed for. Anything else (plaintext, older formats, another organization's
 * or connection's ciphertext) throws SecretDecryptionError.
 */
export function decryptSecret(value: string, binding: SecretBinding): string {
  if (!isEncrypted(value)) {
    throw new SecretDecryptionError(
      "The stored secret is not encrypted for this connection. Open settings so it can be re-encrypted, or enter it again.",
    );
  }
  return decryptParts(value.slice(PREFIX.length), bindingData(binding));
}

/**
 * Brings a stored secret into the current format for `binding`, for the
 * encrypt-only route. Plaintext is encrypted; a v3 value is returned
 * unchanged after checking it really belongs to this organization +
 * connection; older ciphertext is refused (see LEGACY_PREFIXES). Never
 * returns plaintext.
 */
export function sealForConnection(value: string, binding: SecretBinding): string {
  if (isEncrypted(value)) {
    decryptSecret(value, binding);
    return value;
  }
  if (LEGACY_PREFIXES.some((prefix) => value.startsWith(prefix))) {
    throw new SecretDecryptionError(
      "The stored secret uses an older encryption format that is no longer accepted. Enter the secret again.",
    );
  }
  return encryptSecret(value, binding);
}
