import crypto from "crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@/lib/dataDir";

// SECURITY (SEC-B-01): The HMAC secret that signs API key CRCs must never fall
// back to a hardcoded literal. Resolution order:
//   1. process.env.API_KEY_SECRET — operator-supplied, wins in all modes.
//   2. <DATA_DIR>/api-key-secret — minted on first local boot, mode 0o600,
//      reused on every subsequent boot. Only reachable when DATA_DIR is
//      explicitly set, i.e. a real local deployment, not a serverless edge.
//   3. Throw — refuses to silently forge keys with a public secret.
// `requireLogin` is intentionally NOT consulted here: a login-disabled local
// install still needs a stable secret so already-issued keys keep validating.
import { isString } from "./typeChecks.js";
const SECRET_FILE_BASENAME = "api-key-secret";

let cachedSecret = null;

/**
 * Resolve the HMAC secret used to sign API key CRCs.
 * Caches the result on first call so subsequent boots reuse the same value.
 * @returns {string} hex-encoded secret (never logged, never exported).
 */
export function getApiKeySecret() {
  if (cachedSecret) return cachedSecret;

  const fromEnv = process.env.API_KEY_SECRET;
  if (isString(fromEnv) && fromEnv.length > 0) {
    cachedSecret = fromEnv;
    return cachedSecret;
  }

  if (isString(process.env.DATA_DIR) && process.env.DATA_DIR.length > 0) {
    const secretPath = path.join(DATA_DIR, SECRET_FILE_BASENAME);
    let existing = null;
    try {
      existing = fs.readFileSync(secretPath, "utf8").trim();
    } catch (err) {
      if (err && err.code !== "ENOENT") throw err;
    }
    if (existing) {
      cachedSecret = existing;
      return cachedSecret;
    }
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const generated = crypto.randomBytes(32).toString("hex");
    fs.writeFileSync(secretPath, generated, { mode: 0o600 });
    // Warn without leaking the secret value or its full path.
    console.warn(
      "[apiKey] API_KEY_SECRET unset — minted a fresh secret under DATA_DIR/" +
      SECRET_FILE_BASENAME +
      " (mode 0600). Set API_KEY_SECRET explicitly in production."
    );
    cachedSecret = generated;
    return cachedSecret;
  }

  throw new Error("API_KEY_SECRET required (set env var or run with DATA_DIR)");
}

/** Test-only: reset the cached secret so the next getApiKeySecret() re-resolves. */
export function __resetApiKeySecretForTests() {
  cachedSecret = null;
}

/**
 * Generate 6-char random keyId
 */
function generateKeyId() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Generate CRC (8-char HMAC)
 */
function generateCrc(machineId, keyId) {
  return crypto.
  createHmac("sha256", getApiKeySecret()).
  update(machineId + keyId).
  digest("hex").
  slice(0, 8);
}

/**
 * Generate API key with machineId embedded
 * Format: sk-{machineId}-{keyId}-{crc8}
 * @param {string} machineId - 16-char machine ID
 * @returns {{ key: string, keyId: string }}
 */
export function generateApiKeyWithMachine(machineId) {
  const keyId = generateKeyId();
  const crc = generateCrc(machineId, keyId);
  const key = `sk-${machineId}-${keyId}-${crc}`;
  return { key, keyId };
}

/**
 * Parse API key and extract machineId + keyId
 * Supports both formats:
 * - New: sk-{machineId}-{keyId}-{crc8}
 * - Old: sk-{random8}
 * @param {string} apiKey
 * @returns {{ machineId: string, keyId: string, isNewFormat: boolean } | null}
 */
export function parseApiKey(apiKey) {
  if (!apiKey || !apiKey.startsWith("sk-")) return null;

  const parts = apiKey.split("-");

  // New format: sk-{machineId}-{keyId}-{crc8} = 4 parts
  if (parts.length === 4) {
    const [, machineId, keyId, crc] = parts;

    // Validate CRC
    const expectedCrc = generateCrc(machineId, keyId);
    if (crc !== expectedCrc) return null;

    return { machineId, keyId, isNewFormat: true };
  }

  // Old format: sk-{random8} = 2 parts.
  // AGENTS.md §2/§3 invariant: legacy `sk-<8 hex>` keys are accepted as-is and
  // are NOT rewritten by this fix. Only new-format keys are HMAC-bound.
  if (parts.length === 2) {
    return { machineId: null, keyId: parts[1], isNewFormat: false };
  }

  return null;
}

/**
 * Verify API key CRC (only for new format)
 * @param {string} apiKey
 * @returns {boolean}
 */
export function verifyApiKeyCrc(apiKey) {
  const parsed = parseApiKey(apiKey);
  if (!parsed) return false;

  // Old format doesn't have CRC, always valid if parsed
  if (!parsed.isNewFormat) return true;

  // New format already verified in parseApiKey
  return true;
}

/**
 * Check if API key is new format (contains machineId)
 * @param {string} apiKey
 * @returns {boolean}
 */
export function isNewFormatKey(apiKey) {
  const parsed = parseApiKey(apiKey);
  return parsed?.isNewFormat === true;
}