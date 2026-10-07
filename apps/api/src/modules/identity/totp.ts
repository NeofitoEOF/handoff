import crypto from "node:crypto";
import { config } from "../../config.js";

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buffer: Buffer): string {
  let bits = "";
  for (const byte of buffer) bits += byte.toString(2).padStart(8, "0");

  let out = "";
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.slice(i, i + 5).padEnd(5, "0");
    out += alphabet[Number.parseInt(chunk, 2)];
  }
  return out;
}

function base32Decode(value: string): Buffer {
  const normalized = value.replace(/=+$/g, "").toUpperCase();
  let bits = "";
  for (const char of normalized) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error("Invalid base32");
    bits += index.toString(2).padStart(5, "0");
  }

  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function encryptionKey(): Buffer {
  const key = Buffer.from(config.MFA_ENCRYPTION_KEY, "hex");
  if (key.length !== 32) throw new Error("MFA_ENCRYPTION_KEY must be 32 bytes");
  return key;
}

export function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

export function encryptSecret(secret: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
  };
}

export function decryptSecret(input: {
  ciphertext: string;
  iv: string;
  tag: string;
}): string {
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(input.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(input.tag, "base64"));
  const clear = Buffer.concat([
    decipher.update(Buffer.from(input.ciphertext, "base64")),
    decipher.final(),
  ]);
  return clear.toString("utf8");
}

export function generateTotp(secret: string, timestamp = Date.now()): string {
  const counter = Math.floor(timestamp / 1000 / 30);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const digest = crypto
    .createHmac("sha1", base32Decode(secret))
    .update(counterBuffer)
    .digest();

  const offset = digest[digest.length - 1]! & 0x0f;
  const code =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);

  return String(code % 1_000_000).padStart(6, "0");
}

export function verifyTotp(secret: string, token: string, timestamp = Date.now()): boolean {
  if (!/^\d{6}$/.test(token)) return false;
  for (const drift of [-30_000, 0, 30_000]) {
    const expected = generateTotp(secret, timestamp + drift);
    if (
      crypto.timingSafeEqual(
        Buffer.from(expected),
        Buffer.from(token),
      )
    ) return true;
  }
  return false;
}

export function buildOtpAuthUri(input: {
  email: string;
  secret: string;
  issuer?: string;
}): string {
  const issuer = input.issuer ?? "Handoff";
  const label = encodeURIComponent(`${issuer}:${input.email}`);
  return `otpauth://totp/${label}?secret=${input.secret}&issuer=${encodeURIComponent(issuer)}&digits=6&period=30`;
}
