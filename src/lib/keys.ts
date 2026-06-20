// keys.ts — immutable object-key generation (O-03 / P-12).
//
// shelf NEVER echoes a user filename into an object key (path traversal, non-ASCII encoding mismatch,
// overwrite-in-place cache staleness — P-12/P-15/P-34). A new upload is a NEW random key + a DB-pointer
// update, never an overwrite (O-03). The original filename lives in metadata/DB, not the key.

import { randomBytes } from "node:crypto";
import { extname, basename } from "node:path";

/** Characters allowed in a sanitized key segment (defense-in-depth even though we generate random keys). */
const SAFE_SEGMENT = /^[a-zA-Z0-9._-]+$/;

/**
 * Generate a random, immutable object key. Optionally preserve the (sanitized, lowercased) extension so
 * the safe-serve layer can still force a correct Content-Type — but the BODY of the key is random, never
 * the user's filename.
 *
 * @param originalName  the user's filename (used ONLY to recover a safe extension, never the key body)
 * @param prefix        optional key prefix (e.g. "incoming/" for the quarantine-before-clean pattern)
 */
export function randomKey(originalName?: string, prefix?: string): string {
  const id = randomBytes(16).toString("hex");
  const ext = safeExtension(originalName);
  const body = ext ? `${id}${ext}` : id;
  const p = prefix ? normalizePrefix(prefix) : "";
  return `${p}${body}`;
}

/** Recover a safe, lowercased extension from a filename, or "" if none/unsafe. */
export function safeExtension(name?: string): string {
  if (!name) return "";
  const ext = extname(basename(name)).toLowerCase();
  // Allow only a short alphanumeric extension; reject anything weird (e.g. "..%2f", multi-dot tricks).
  if (/^\.[a-z0-9]{1,8}$/.test(ext)) return ext;
  return "";
}

/** Normalize a prefix to a single trailing slash and reject traversal. */
export function normalizePrefix(prefix: string): string {
  const trimmed = prefix.replace(/^\/+/, "").replace(/\/+$/, "");
  if (trimmed.includes("..")) throw new Error(`unsafe key prefix (contains '..'): ${prefix}`);
  return trimmed ? `${trimmed}/` : "";
}

/**
 * Reject a caller-supplied key that would be a P-12 footgun: traversal, or a raw user filename. We don't
 * forbid explicit keys (agents legitimately set deterministic keys for tests), but we DO block traversal.
 */
export function assertSafeKey(key: string): void {
  if (key.includes("..")) throw new Error(`unsafe object key (contains '..'): ${key}`);
  if (key.startsWith("/")) throw new Error(`object key must not start with '/': ${key}`);
  const last = key.split("/").pop() ?? key;
  if (last !== "" && !SAFE_SEGMENT.test(last) && /[\x00-\x1f]/.test(last)) {
    throw new Error(`object key contains control characters: ${key}`);
  }
}
