/**
 * At-rest encryption and scrubbed-export handling for secrets nested under
 * `providerSpecificData` (issue #2281).
 *
 * Scrubbed exports prefer the same allowlist shape as
 * `sanitizeProviderConnectionForClient` (`SAFE_PSD_FIELDS`), plus a few
 * non-secret transfer fields. Encryption targets explicit secret keys and
 * secret-like names, leaving allowlisted / known-non-secret ids alone.
 */
import {
  decryptField,
  encryptField,
  isEncryptedBlob } from
"../../crypto/columnCrypto.js";
import { isObject, isString } from "../../../shared/utils/typeChecks.js";

/** Allowlisted PSD keys kept in scrubbed exports (mirrors client sanitize). */
export const SAFE_PSD_EXPORT_FIELDS = Object.freeze([
"baseUrl", "azureEndpoint", "deployment", "apiVersion", "accountId",
"region", "projectId", "resourceUrl", "proxyPoolId", "cx",
"connectionProxyEnabled", "connectionProxyUrl", "connectionNoProxy",
"githubLogin", "githubName", "githubEmail", "githubUserId",
"username", "firstName", "lastName", "authMethod", "authKind",
"profileArn", "codexFingerprintMode", "codexUltrafastMode", "aiCreditLimit",
"openaiStoreEnabled", "strictChatHistory",
// Bedrock mode markers — not credentials; Access Key Id is an identifier.
"profile", "accessKeyId",
// Expiry metadata for nested tokens (the token itself is secret).
"copilotTokenExpiresAt"]
);

const SAFE_PSD_EXPORT_SET = new Set(SAFE_PSD_EXPORT_FIELDS);

/**
 * Explicit nested secrets named by #2281 / TRANSFER_SECRET_LIKE_KEYS.
 * `extraApiKeys` is an array of string credentials.
 */
export const SENSITIVE_PSD_KEYS = Object.freeze([
"cookie",
"BXAuth",
"clientSecret",
"mimoPassToken",
"dcaToken",
"copilotToken",
"extraApiKeys",
"authorization",
"proxyPassword",
"proxyUrl",
"refresh_token",
"password",
"secret",
"opendesignControlKey",
"qwenCloudCookie",
"alibabaConsoleCookie",
"QWEN_CLOUD_COOKIE"]
);

const SENSITIVE_PSD_SET = new Set(SENSITIVE_PSD_KEYS);

/** Keys that match the secret-like regex but are not credentials. */
const NON_SECRET_PSD_KEY_EXCEPTIONS = new Set([
"copilotTokenExpiresAt",
"tokenType",
"tokenEndpoint",
"token_type",
"expiresIn"]
);

const SECRET_LIKE_PSD_KEY = /(secret|token|cookie|password)/i;
const URL_PSD_KEYS = new Set(["baseUrl", "azureEndpoint", "resourceUrl", "connectionProxyUrl"]);

function isCredentialedUrl(value) {
  if (!isString(value) || !value) return false;
  try {
    const parsed = new URL(value);
    return Boolean(parsed.username || parsed.password);
  } catch {
    return false;
  }
}

/**
 * @param {string} key
 * @returns {boolean}
 */
export function isSensitiveProviderSpecificDataKey(key) {
  if (!isString(key) || !key) return false;
  if (SAFE_PSD_EXPORT_SET.has(key) || NON_SECRET_PSD_KEY_EXCEPTIONS.has(key)) return false;
  if (SENSITIVE_PSD_SET.has(key)) return true;
  return SECRET_LIKE_PSD_KEY.test(key);
}

/**
 * @param {string} rowId
 * @param {string} key
 * @returns {string}
 */
function psdAad(rowId, key) {
  return `${rowId}:psd:${key}`;
}

/**
 * Drop userinfo from a URL, or return null when the value carried credentials.
 * Non-URL strings pass through unchanged.
 * @param {unknown} value
 * @returns {unknown}
 */
export function scrubCredentialedUrl(value) {
  if (!isString(value) || !value) return value;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return value;
  }
  if (!parsed.username && !parsed.password) return value;
  return null;
}

/**
 * @param {unknown} value
 * @param {string} aad
 * @returns {unknown}
 */
function encryptPsdValue(value, aad) {
  if (isEncryptedBlob(value)) return value;
  if (isString(value) && value.length > 0) return encryptField(value, aad);
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (isEncryptedBlob(item)) return item;
      if (isString(item) && item.length > 0) return encryptField(item, aad);
      return item;
    });
  }
  return value;
}

/**
 * @param {unknown} value
 * @param {string} aad
 * @returns {unknown}
 */
function decryptPsdValue(value, aad) {
  if (isEncryptedBlob(value)) {
    try { return decryptField(value, aad); } catch {
      console.warn("Unable to decrypt provider-specific credential");
      return null;
    }
  }
  if (Array.isArray(value)) {
    return value.map((item) => decryptPsdValue(item, aad));
  }
  return value;
}

/**
 * Encrypt nested PSD secrets in place for durable storage. Plaintext legacy
 * values and already-encrypted blobs are handled; allowlisted keys stay plain.
 * @param {unknown} providerSpecificData
 * @param {string} rowId
 * @returns {unknown}
 */
export function encryptProviderSpecificData(providerSpecificData, rowId) {
  if (!providerSpecificData || !isObject(providerSpecificData) || Array.isArray(providerSpecificData)) {
    return providerSpecificData;
  }
  const out = { ...providerSpecificData };
  for (const [key, value] of Object.entries(out)) {
    if (!isSensitiveProviderSpecificDataKey(key) && !(URL_PSD_KEYS.has(key) && (isEncryptedBlob(value) || isCredentialedUrl(value)))) continue;
    out[key] = encryptPsdValue(value, psdAad(rowId, key));
  }
  return out;
}

/**
 * Decrypt nested PSD secrets for callers. Legacy plaintext passes through.
 * @param {unknown} providerSpecificData
 * @param {string} rowId
 * @returns {unknown}
 */
export function decryptProviderSpecificData(providerSpecificData, rowId) {
  if (!providerSpecificData || !isObject(providerSpecificData) || Array.isArray(providerSpecificData)) {
    return providerSpecificData;
  }
  const out = { ...providerSpecificData };
  for (const [key, value] of Object.entries(out)) {
    if (!isSensitiveProviderSpecificDataKey(key) && !(URL_PSD_KEYS.has(key) && (isEncryptedBlob(value) || isCredentialedUrl(value)))) continue;
    out[key] = decryptPsdValue(value, psdAad(rowId, key));
  }
  return out;
}

/**
 * Allowlist PSD for scrubbed (includeSecrets:false) exports.
 * Credentialed URLs on allowlisted URL fields are dropped.
 * @param {unknown} providerSpecificData
 * @returns {Record<string, unknown>|undefined}
 */
export function scrubProviderSpecificDataForExport(providerSpecificData) {
  if (!providerSpecificData || !isObject(providerSpecificData) || Array.isArray(providerSpecificData)) {
    return undefined;
  }
  const psd = {};
  for (const key of SAFE_PSD_EXPORT_FIELDS) {
    if (!Object.hasOwn(providerSpecificData, key)) continue;
    const value = providerSpecificData[key];
    if (value === undefined) continue;
    if (key === "connectionProxyUrl" || key === "baseUrl" || key === "azureEndpoint" || key === "resourceUrl") {
      const safe = scrubCredentialedUrl(value);
      if (safe === null) continue;
      psd[key] = safe;
      continue;
    }
    psd[key] = value;
  }
  return psd;
}

/**
 * Remove signing secrets and credentialed proxy URLs from settings for scrubbed export.
 * @param {Record<string, unknown>} settings
 * @returns {Record<string, unknown>}
 */
export function scrubSettingsSecretsForExport(settings) {
  if (!settings || !isObject(settings) || Array.isArray(settings)) return settings;
  const out = { ...settings };
  delete out.postgresUrl;
  if (Object.hasOwn(out, "outboundProxyUrl")) {
    const safe = scrubCredentialedUrl(out.outboundProxyUrl);
    if (safe === null) delete out.outboundProxyUrl;
    else out.outboundProxyUrl = safe;
  }
  if (Array.isArray(out.operatorWebhooks)) {
    out.operatorWebhooks = out.operatorWebhooks.map((hook) => {
      if (!hook || !isObject(hook) || Array.isArray(hook)) return hook;
      const next = { ...hook };
      delete next.secret;
      return next;
    });
  }
  return out;
}

/**
 * Scrub credentialed proxy pool URLs for scrubbed export.
 * @param {Record<string, unknown>} pool
 * @returns {Record<string, unknown>}
 */
export function scrubProxyPoolForExport(pool) {
  if (!pool || !isObject(pool) || Array.isArray(pool)) return pool;
  const out = { ...pool };
  if (Object.hasOwn(out, "proxyUrl")) {
    const safe = scrubCredentialedUrl(out.proxyUrl);
    if (safe === null) delete out.proxyUrl;
    else out.proxyUrl = safe;
  }
  // Deploy-time relay gate (issue #2440): never ship it in a scrubbed export.
  delete out.relaySecret;
  return out;
}
