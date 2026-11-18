/**
 * AES-GCM-256 encryption with a base64 key held in a Workers secret
 * (TOKEN_ENC_KEY for Plaid access tokens, BACKUP_ENC_KEY for backups).
 * Format: "v1:<base64 iv>:<base64 ciphertext+tag>". Uses only WebCrypto, so
 * it runs the same in the Worker and in Node scripts.
 */
const VERSION = "v1";

function b64encode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function b64decode(text: string): Uint8Array<ArrayBuffer> {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function importKey(base64Key: string): Promise<CryptoKey> {
  const raw = b64decode(base64Key);
  if (raw.length !== 32) throw new Error("Encryption key must be 32 bytes (base64)");
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptString(plaintext: string, base64Key: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await importKey(base64Key);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext)));
  return `${VERSION}:${b64encode(iv)}:${b64encode(ct)}`;
}

export async function decryptString(ciphertext: string, base64Key: string): Promise<string> {
  const [version, iv, data] = ciphertext.split(":");
  if (version !== VERSION || !iv || !data) throw new Error("Unrecognised ciphertext format");
  const key = await importKey(base64Key);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64decode(iv) }, key, b64decode(data));
  return new TextDecoder().decode(pt);
}
