// Mirrors src/lib/transfer/crypto.ts parameters to sanity-check the algorithm.
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const key = randomBytes(32);
const PREFIX = "enc:v1:";

function encrypt(plain) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${data.toString("base64")}`;
}
function decrypt(value) {
  const [iv, tag, data] = value.slice(PREFIX.length).split(":").map(p => Buffer.from(p, "base64"));
  const d = createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString("utf8");
}

const secret = "my-super-secret-Va1ue!@#";
const enc = encrypt(secret);
console.log("ciphertext:", enc.slice(0, 40) + "...");
console.log("roundtrip ok:", decrypt(enc) === secret);
// Tamper check: flip a char in the payload → must throw
const tampered = enc.slice(0, -2) + (enc.endsWith("A") ? "B=" : "A=");
try { decrypt(tampered); console.log("tamper check: FAILED (no throw)"); }
catch { console.log("tamper check: ok (throws)"); }
// Unique IVs
console.log("unique ciphertexts:", encrypt(secret) !== encrypt(secret));
