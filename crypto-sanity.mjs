// Mirrors src/lib/transfer/crypto.ts parameters to sanity-check the algorithm.
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const key = randomBytes(32);
const PREFIX = "enc:v2:";
const bind = (host, clientId) => Buffer.from(`${host.toLowerCase()}|${clientId}`, "utf8");

function encrypt(plain, host, clientId) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(bind(host, clientId));
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${data.toString("base64")}`;
}
function decrypt(value, host, clientId) {
  const [iv, tag, data] = value.slice(PREFIX.length).split(":").map(p => Buffer.from(p, "base64"));
  const d = createDecipheriv("aes-256-gcm", key, iv);
  d.setAAD(bind(host, clientId));
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString("utf8");
}
function throws(fn) {
  try { fn(); return false; } catch { return true; }
}

const host = "my-env.sitecorecloud.io";
const clientId = "abc123";
const secret = "my-super-secret-Va1ue!@#";
const enc = encrypt(secret, host, clientId);
console.log("ciphertext:", enc.slice(0, 40) + "...");
console.log("roundtrip ok:", decrypt(enc, host, clientId) === secret);
// Tamper check: flip a char in the payload → must throw
const tampered = enc.slice(0, -2) + (enc.endsWith("A") ? "B=" : "A=");
console.log("tamper check:", throws(() => decrypt(tampered, host, clientId)) ? "ok (throws)" : "FAILED (no throw)");
// Binding checks: another host or client ID → must throw
console.log("other host rejected:", throws(() => decrypt(enc, "evil.sitecorecloud.io", clientId)));
console.log("other client id rejected:", throws(() => decrypt(enc, host, "other")));
// Unique IVs
console.log("unique ciphertexts:", encrypt(secret, host, clientId) !== encrypt(secret, host, clientId));
