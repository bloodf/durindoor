import { timingSafeEqual } from "node:crypto";
import { isString } from "./typeChecks.js";

/**
 * Constant-time equality check for secrets: API keys, shared/management keys,
 * dashboard passwords, HMAC/CRC signatures, OAuth state/claim tokens, MITM
 * proof tokens, and TOTP codes.
 *
 * `===`/`!==` on a secret short-circuits at the first mismatched byte, and the
 * time that takes leaks how many leading bytes an attacker guessed correctly
 * (CWE-208). This never does that: unequal-length inputs return `false`
 * immediately (length is not the secret; content is), and same-length inputs
 * always go through `crypto.timingSafeEqual`, which compares in constant time
 * regardless of where the first difference falls.
 *
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
export function timingSafeCompare(a, b) {
  if (!isString(a) || !isString(b)) return false;
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
