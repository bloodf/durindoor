import { CODEX_FINGERPRINT_MODES } from "../../../open-sse/config/codexIdentity.js";

const SAFE_FIELDS = [
  "id", "provider", "authType", "name", "email", "displayName",
  "priority", "globalPriority", "isActive", "defaultModel",
  "testStatus", "lastError", "lastErrorAt", "errorCode",
  "expiresAt", "lastUsedAt", "consecutiveUseCount",
  "createdAt", "updatedAt",
];

const SAFE_PSD_FIELDS = [
  "baseUrl", "azureEndpoint", "deployment", "apiVersion", "accountId",
  "region", "projectId", "resourceUrl", "proxyPoolId", "cx",
  "connectionProxyEnabled", "connectionProxyUrl", "connectionNoProxy",
  "githubLogin", "githubName", "githubEmail", "githubUserId",
  "username", "firstName", "lastName", "authMethod", "authKind",
  "profileArn", "codexFingerprintMode",
];

function maskName(name) {
  if (typeof name !== "string" || name.length <= 16) return name;
  if (/[a-zA-Z0-9_-]{32,}/.test(name)) return `${name.slice(0, 8)}***`;
  return name;
}

export function sanitizeProviderConnectionForClient(c) {
  const safe = {};
  for (const f of SAFE_FIELDS) if (c[f] !== undefined) safe[f] = c[f];
  /** Report stale unavailable status as active once every model cooldown expires. */
  if (safe.testStatus === "unavailable") {
    const hasActiveLock = Object.entries(c).some(([key, value]) =>
      key.startsWith("modelLock_") && value && new Date(value).getTime() > Date.now()
    );
    if (!hasActiveLock) safe.testStatus = "active";
  }
  if (safe.name) safe.name = maskName(safe.name);
  if (c.providerSpecificData) {
    const psd = {};
    for (const f of SAFE_PSD_FIELDS) {
      if (c.provider === "codex" && f === "accountId") continue;
      if (c.providerSpecificData[f] === undefined) continue;
      if (f === "codexFingerprintMode") {
        if (CODEX_FINGERPRINT_MODES.includes(c.providerSpecificData[f])) psd[f] = c.providerSpecificData[f];
        continue;
      }
      psd[f] = c.providerSpecificData[f];
    }
    safe.providerSpecificData = psd;
  }
  return safe;
}
