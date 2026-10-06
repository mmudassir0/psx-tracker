import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";

/**
 * Backup file format: "PSXB1" | salt(16) | iv(12) | auth tag(16) | ciphertext,
 * where the plaintext is gzipped JSON and the key is scrypt(passphrase, salt).
 * AES-256-GCM, so a wrong passphrase or any tampering fails loudly instead of
 * producing garbage.
 */
const MAGIC = Buffer.from("PSXB1");
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function key(passphrase: string, salt: Buffer): Buffer {
  if (passphrase.length < 16) throw new Error("BACKUP_PASSPHRASE must be at least 16 characters.");
  return scryptSync(passphrase, salt, 32, SCRYPT);
}

export function encryptBackup(json: string, passphrase: string): Buffer {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(passphrase, salt), iv);
  const body = Buffer.concat([cipher.update(gzipSync(json)), cipher.final()]);
  return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), body]);
}

export function decryptBackup(file: Buffer, passphrase: string): string {
  if (!file.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("Not a PSX Tracker backup file.");
  let offset = MAGIC.length;
  const salt = file.subarray(offset, (offset += 16));
  const iv = file.subarray(offset, (offset += 12));
  const tag = file.subarray(offset, (offset += 16));
  const decipher = createDecipheriv("aes-256-gcm", key(passphrase, salt), iv);
  decipher.setAuthTag(tag);
  try {
    const zipped = Buffer.concat([decipher.update(file.subarray(offset)), decipher.final()]);
    return gunzipSync(zipped).toString("utf8");
  } catch {
    throw new Error("Wrong passphrase, or the file is damaged.");
  }
}
