/**
 * Guard against storing a credential that is already an encrypted envelope.
 *
 * DurinDoor encrypts every credential column on write (see
 * `src/lib/crypto/columnCrypto.js`), so a value that is *already* an envelope
 * is stored as a fresh ciphertext of a ciphertext. It can never decrypt back
 * to the plaintext key, and the only symptom is a misleading "Missing API key"
 * on the connection test.
 *
 * The canonical envelope is the JSON object `{v, iv, ct}`. A user who copies
 * a row out of the database, exports a connection bundle, or pastes a value
 * from another tool's credential store can easily hand that blob over as the
 * API key. Reject it at the provider write boundary, where the mistake can
 * still be corrected, instead of storing a credential that can never work.
 *
 * Ported from OmniRoute #15932. The check is kept dependency-free (no
 * node:crypto) so it can run in client-side code as well.
 */

import { isRecord, isString } from "./typeChecks.js";

/** The envelope version this build writes. */
const ENVELOPE_VERSION = 1;

/**
 * True when a parsed envelope carries the encrypted-credential fields.
 * @param {unknown} value
 * @returns {boolean}
 */
function isEnvelopeFields(value) {
  if (!isRecord(value)) return false;
  const blob = /** @type {Record<string, unknown>} */ (value);
  return blob.v === ENVELOPE_VERSION &&
    isString(blob.iv) && blob.iv.length > 0 &&
    isString(blob.ct) && blob.ct.length > 0;
}

/**
 * True when `value` looks like a DurinDoor encrypted credential envelope.
 *
 * The value may arrive as an object (the parsed JSON) or as a JSON string
 * (the envelope serialized into the API-key field). A JSON string is only
 * treated as an envelope when it parses to exactly the envelope shape, so a
 * plaintext key that merely happens to start with `{` is not rejected.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function looksLikeEncryptedEnvelope(value) {
  if (value === null || value === undefined) return false;

  if (isRecord(value)) return isEnvelopeFields(value);

  if (!isString(value)) return false;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return false;
  try {
    return isEnvelopeFields(JSON.parse(trimmed));
  } catch {
    return false;
  }
}

/**
 * The error message returned for an encrypted-envelope credential.
 * @returns {string}
 */
export function encryptedEnvelopeCredentialMessage() {
  return "apiKey looks like an encrypted credential envelope, not a plaintext key — store the plaintext API key";
}
