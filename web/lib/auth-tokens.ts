import { randomBytes, randomInt } from "node:crypto";
import bcrypt from "bcryptjs";

// crypto.randomInt is cryptographically secure — Math.random is not, and
// 6-digit codes have only ~20 bits of entropy to begin with. Don't make
// it worse.
export function generateVerificationCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export async function hashCode(code: string): Promise<string> {
  return bcrypt.hash(code, 10);
}

export async function verifyCode(code: string, hash: string): Promise<boolean> {
  return bcrypt.compare(code, hash);
}

// 32 bytes = 256 bits of entropy. Stored plaintext (the entropy carries
// the security; bcrypt-hashing wouldn't add anything meaningful at this
// length and would make lookups slower).
export function generateResetToken(): string {
  return randomBytes(32).toString("hex");
}
