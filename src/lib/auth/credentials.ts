import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { getSettings } from "@/lib/db/settings";
import { env } from "@/lib/env";

const HASH_PREFIX = "scrypt";
const KEY_LENGTH = 64;

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export function hashAdminPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, KEY_LENGTH).toString("hex");
  return `${HASH_PREFIX}$${salt}$${hash}`;
}

function verifyHash(password: string, encoded: string): boolean {
  const [prefix, salt, expectedHex] = encoded.split("$");
  if (prefix !== HASH_PREFIX || !salt || !expectedHex) return false;

  try {
    const actual = scryptSync(password, salt, KEY_LENGTH);
    const expected = Buffer.from(expectedHex, "hex");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

async function storedCredentials() {
  try {
    const settings = await getSettings();
    return {
      email: settings.admin_email?.trim().toLowerCase() || env.adminEmail,
      passwordHash: settings.admin_password_hash || null,
    };
  } catch {
    // A fresh install or a temporarily unavailable database can still use the
    // bootstrap credentials from the environment.
    return { email: env.adminEmail, passwordHash: null };
  }
}

export async function verifyAdminLogin(email: string, password: string): Promise<boolean> {
  const credentials = await storedCredentials();
  if (!safeEqual(email.trim().toLowerCase(), credentials.email)) return false;
  return credentials.passwordHash
    ? verifyHash(password, credentials.passwordHash)
    : safeEqual(password, env.adminPassword);
}

export async function verifyCurrentAdminPassword(password: string): Promise<boolean> {
  const credentials = await storedCredentials();
  return credentials.passwordHash
    ? verifyHash(password, credentials.passwordHash)
    : safeEqual(password, env.adminPassword);
}
