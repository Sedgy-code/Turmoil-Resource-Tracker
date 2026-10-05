import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { ApiError } from "./errors";

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
export function randomToken(): string {
  return randomBytes(32).toString("base64url");
}
export function timingSafeMatch(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
function key(): Buffer {
  if (!process.env.AUTH_SECRET || process.env.AUTH_SECRET.length < 32)
    throw new ApiError(
      503,
      "Authentication is not configured.",
      "AUTH_NOT_CONFIGURED",
    );
  return createHash("sha256").update(process.env.AUTH_SECRET).digest();
}
export function encrypt(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString(
    "base64url",
  );
}
export function decrypt(value: string): string {
  const data = Buffer.from(value, "base64url");
  if (data.length < 28) throw new Error("Invalid encrypted token");
  const decipher = createDecipheriv("aes-256-gcm", key(), data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([
    decipher.update(data.subarray(28)),
    decipher.final(),
  ]).toString("utf8");
}
