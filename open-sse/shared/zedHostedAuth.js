// Zed-hosted sign-in, LLM-token exchange and model catalog helpers (staged).
//
// Ported from OmniRoute release/v3.8.55 (4265bb2ad5477450a07d3a43ea33a62c6c874878),
// open-sse/shared/zedAuth.ts (MIT), itself a port of decolua/9router PR #2328.
//
// Zed's native-app sign-in uses an ephemeral RSA keypair, not a registered OAuth
// client id/secret:
//   1. Generate an RSA keypair and send its public key to zed.dev/native_app_signin.
//   2. The user signs in in their own browser.
//   3. Zed redirects to http://127.0.0.1:<native_app_port>/?user_id=...&access_token=...
//      with the access token encrypted to the public key.
//   4. The private key, which never leaves the gateway, decrypts the token.
// The long-lived access token then buys short-lived LLM tokens from
// cloud.zed.dev/client/llm_tokens, which authenticate /models and /completions.
//
// Nothing here runs unless a connection opted in with
// providerSpecificData.enableSessionDispatch === true; the guard lives in
// zedHostedOptIn() and is enforced by the executor and by model discovery.
import crypto from "node:crypto";
import { isFunction, isObject, isString } from "../../src/shared/utils/typeChecks.js";

export const ZED_WEB_BASE_URL = "https://zed.dev";
export const ZED_CLOUD_BASE_URL = "https://cloud.zed.dev";
export const ZED_LLM_BASE_URL = "https://cloud.zed.dev";
export const ZED_DEFAULT_NATIVE_APP_PORT = 58443;
export const ZED_OPT_IN_KEY = "enableSessionDispatch";

export const ZED_HOSTED_CONFIG = Object.freeze({
  webBaseUrl: ZED_WEB_BASE_URL,
  cloudBaseUrl: ZED_CLOUD_BASE_URL,
  llmBaseUrl: ZED_LLM_BASE_URL,
  defaultNativeAppPort: ZED_DEFAULT_NATIVE_APP_PORT,
});

export const ZED_HEADERS = Object.freeze({
  expiredToken: "x-zed-expired-token",
  outdatedToken: "x-zed-outdated-token",
  clientSupportsStatus: "x-zed-client-supports-status-messages",
  clientSupportsStreamEnded: "x-zed-client-supports-stream-ended-request-completion-status",
  serverSupportsStatus: "x-zed-server-supports-status-messages",
  clientSupportsXai: "x-zed-client-supports-x-ai",
  systemId: "x-zed-system-id",
});

const PRIVATE_KEY_PREFIX = "zed-rsa-pkcs1:";
const LLM_TOKEN_TTL_MS = 50 * 60 * 1000;
const MODEL_CACHE_TTL_MS = 60 * 60 * 1000;

const llmTokenCache = new Map();
const modelCache = new Map();
const modelInflight = new Map();

/** The only opt-in: the boolean `true` on this connection's own providerSpecificData. */
export function zedHostedOptIn(credentials) {
  return credentials?.providerSpecificData?.[ZED_OPT_IN_KEY] === true;
}

export class ZedHostedError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "ZedHostedError";
    this.status = status;
    this.code = code;
  }
}

export function zedDispatchDisabledError() {
  return new ZedHostedError(
    403,
    "zed_hosted_dispatch_disabled",
    `Zed-hosted dispatch is disabled for this connection. Set providerSpecificData.${ZED_OPT_IN_KEY} to true to opt in.`
  );
}

function fetchFor(options) {
  return isFunction(options?.fetch) ? options.fetch : globalThis.fetch;
}

const b64url = (value) => Buffer.from(value).toString("base64url");
const fromB64url = (value) => Buffer.from(String(value || ""), "base64url").toString("utf8");
// Zed expects the public key base64url-encoded with padding kept.
const b64urlPadded = (value) => value.toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
const normalizeBaseUrl = (baseUrl, fallback) => String(baseUrl || fallback).replace(/\/+$/, "");
const zedUrl = (config, key, path, fallback) => `${normalizeBaseUrl(config?.[key], fallback)}${path}`;

/** Wrap a PEM private key so it can ride in the generic OAuth `codeVerifier` slot. */
export function encodeZedPrivateKeyVerifier(privateKeyPem) {
  return `${PRIVATE_KEY_PREFIX}${b64url(privateKeyPem)}`;
}

export function decodeZedPrivateKeyVerifier(verifier) {
  const value = String(verifier || "");
  if (!value.startsWith(PRIVATE_KEY_PREFIX)) {
    throw new Error("Missing Zed private key verifier; restart the login flow");
  }
  return fromB64url(value.slice(PRIVATE_KEY_PREFIX.length));
}

/** Fresh RSA keypair plus the zed.dev native_app_signin URL that carries its public half. */
export function createZedNativeAuthData(config = ZED_HOSTED_CONFIG, options = {}) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "pkcs1", format: "der" },
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
  });
  const nativeAppPort = Number(options.nativeAppPort || config.defaultNativeAppPort || ZED_DEFAULT_NATIVE_APP_PORT);
  const systemId = options.systemId || crypto.randomUUID();
  const publicKeyString = b64urlPadded(publicKey);
  const signInUrl = new URL(`${normalizeBaseUrl(config.webBaseUrl, ZED_WEB_BASE_URL)}/native_app_signin`);
  signInUrl.searchParams.set("native_app_port", String(nativeAppPort));
  signInUrl.searchParams.set("native_app_public_key", publicKeyString);
  signInUrl.searchParams.set("system_id", systemId);
  return {
    authUrl: signInUrl.toString(),
    privateKeyVerifier: encodeZedPrivateKeyVerifier(privateKey),
    nativeAppPort,
    systemId,
    publicKey: publicKeyString,
  };
}

/** Parse the pasted callback URL, query string or JSON into { userId, encryptedAccessToken }. */
export function parseZedCallbackPayload(input) {
  const raw = String(input || "").trim();
  if (!raw) throw new Error("Missing Zed callback URL");
  let data = {};
  try {
    data = JSON.parse(raw);
  } catch {
    let url;
    try {
      url = new URL(raw);
    } catch {
      try {
        url = new URL(`http://127.0.0.1/?${raw.replace(/^\?/, "")}`);
      } catch {
        throw new Error("Invalid Zed callback URL");
      }
    }
    url.searchParams.forEach((value, key) => { data[key] = value; });
  }
  const userId = data?.user_id || data?.userId;
  const encryptedAccessToken = data?.access_token || data?.accessToken || data?.token;
  if (!userId || !encryptedAccessToken) throw new Error("Zed callback must include user_id and access_token");
  return { userId: String(userId), encryptedAccessToken: String(encryptedAccessToken) };
}

// Zed access tokens are printable ASCII without whitespace. OpenSSL's PKCS#1 v1.5
// "implicit rejection" returns random bytes instead of failing for a wrong key, so a
// result is only accepted when it looks like a token.
const ACCESS_TOKEN_PATTERN = /^[\x21-\x7e]{8,4096}$/;

/** Decrypt the RSA-encrypted access token with the private key from the login attempt. */
export function decryptZedAccessToken(encryptedAccessToken, privateKeyVerifier) {
  const privateKey = decodeZedPrivateKeyVerifier(privateKeyVerifier);
  const encrypted = Buffer.from(String(encryptedAccessToken), "base64url");
  const attempts = [
    { key: privateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
    { key: privateKey, padding: crypto.constants.RSA_PKCS1_PADDING },
  ];
  let firstError = null;
  for (const options of attempts) {
    try {
      const token = crypto.privateDecrypt(options, encrypted).toString("utf8");
      if (ACCESS_TOKEN_PATTERN.test(token)) return token;
      firstError ??= new Error("decrypted value is not an access token");
    } catch (error) {
      firstError ??= error;
    }
  }
  throw new Error(`Failed to decrypt Zed access token: ${firstError?.message || "unknown error"}`);
}

export function buildZedUserAuthHeader(credentials) {
  const userId = credentials?.providerSpecificData?.userId || credentials?.userId;
  const accessToken = credentials?.accessToken || credentials?.apiKey;
  if (!userId || !accessToken) throw new ZedHostedError(401, "zed_hosted_missing_sign_in", "Zed credential is missing userId or accessToken");
  return `${userId} ${accessToken}`;
}

const getSystemId = (credentials) => String(credentials?.providerSpecificData?.systemId || credentials?.systemId || "");

async function fetchJson(fetchImpl, url, init) {
  const res = await fetchImpl(url, init);
  const text = await res.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
  }
  if (!res.ok) {
    const message = data?.message || data?.error?.message || (isString(data?.error) ? data.error : "") || text || `HTTP ${res.status}`;
    const error = new ZedHostedError(res.status, `zed_hosted_http_${res.status}`, String(message).slice(0, 512));
    error.body = data;
    throw error;
  }
  return data;
}

export async function fetchZedAuthenticatedUser(credentials, options = {}) {
  const headers = { Accept: "application/json", Authorization: buildZedUserAuthHeader(credentials) };
  const systemId = getSystemId(credentials);
  if (systemId) headers[ZED_HEADERS.systemId] = systemId;
  return fetchJson(fetchFor(options), zedUrl(options.config, "cloudBaseUrl", "/client/users/me", ZED_CLOUD_BASE_URL), {
    method: "GET", headers, signal: options.signal ?? undefined,
  });
}

function normalizeOrganizationId(value) {
  if (!value) return "";
  if (isString(value)) return value;
  if (isObject(value)) {
    if (isString(value[0])) return value[0];
    if (isString(value.id)) return value.id;
  }
  return String(value);
}

export function resolveZedOrganizationId(credentials, userInfo = null) {
  const psd = credentials?.providerSpecificData || {};
  const explicit = normalizeOrganizationId(psd.organizationId || psd.defaultOrganizationId);
  if (explicit) return explicit;
  const fromUser = normalizeOrganizationId(userInfo?.default_organization_id || userInfo?.defaultOrganizationId);
  if (fromUser) return fromUser;
  const org = (userInfo?.organizations || []).find((item) => item?.is_personal) || userInfo?.organizations?.[0];
  return normalizeOrganizationId(org?.id);
}

// Cache keys hash the full credential so two connections can never share an entry,
// even when their user ids, organizations or token tails collide.
function credentialKey(credentials, organizationId) {
  const psd = credentials?.providerSpecificData || {};
  const token = credentials?.accessToken || credentials?.apiKey || "";
  return crypto
    .createHash("sha256")
    .update([psd.userId || credentials?.userId || "", organizationId || "", token].join("\n"))
    .digest("hex");
}

export async function fetchZedLlmToken(credentials, options = {}) {
  const fetchImpl = fetchFor(options);
  let organizationId = options.organizationId || resolveZedOrganizationId(credentials);
  if (!organizationId) {
    organizationId = resolveZedOrganizationId(credentials, await fetchZedAuthenticatedUser(credentials, options));
  }
  if (!organizationId) throw new ZedHostedError(400, "zed_hosted_no_organization", "No Zed organization selected");

  const cacheKey = credentialKey(credentials, organizationId);
  const cached = llmTokenCache.get(cacheKey);
  if (!options.forceRefresh && cached && cached.expiresAt > Date.now()) return cached.token;

  const headers = { "Content-Type": "application/json", Accept: "application/json", Authorization: buildZedUserAuthHeader(credentials) };
  const systemId = getSystemId(credentials);
  if (systemId) headers[ZED_HEADERS.systemId] = systemId;
  const data = await fetchJson(fetchImpl, zedUrl(options.config, "cloudBaseUrl", "/client/llm_tokens", ZED_CLOUD_BASE_URL), {
    method: "POST", headers, body: JSON.stringify({ organization_id: organizationId }), signal: options.signal ?? undefined,
  });
  const token = isString(data?.token) ? data.token : data?.token?.[0] || data?.token?.value;
  if (!token) throw new ZedHostedError(502, "zed_hosted_empty_llm_reply", "Zed did not return an LLM token");
  llmTokenCache.set(cacheKey, { token, expiresAt: Date.now() + LLM_TOKEN_TTL_MS });
  return token;
}

export function shouldRefreshZedLlmToken(response) {
  return response?.status === 401
    || !!response?.headers?.has?.(ZED_HEADERS.expiredToken)
    || !!response?.headers?.has?.(ZED_HEADERS.outdatedToken);
}

/** Fetch a cloud.zed.dev LLM path, re-exchanging the LLM token once when it expired. */
export async function zedLlmFetch(credentials, path, options = {}) {
  const fetchImpl = fetchFor(options);
  const url = zedUrl(options.config, "llmBaseUrl", path, ZED_LLM_BASE_URL);
  const send = async (forceRefresh) => {
    const token = await fetchZedLlmToken(credentials, { ...options, forceRefresh });
    return fetchImpl(url, {
      ...options.fetchOptions,
      headers: { ...(options.fetchOptions?.headers || {}), Authorization: `Bearer ${token}` },
      signal: options.signal ?? undefined,
    });
  };
  let response = await send(Boolean(options.forceRefresh));
  if (shouldRefreshZedLlmToken(response)) {
    await response.body?.cancel?.().catch(() => {});
    response = await send(true);
  }
  return response;
}

function normalizeZedModelId(id) {
  if (!id) return "";
  if (isString(id)) return id;
  if (isObject(id)) {
    if (isString(id[0])) return id[0];
    if (isString(id.id)) return id.id;
  }
  return String(id);
}

export function mapZedModel(model) {
  const id = normalizeZedModelId(model?.id);
  if (!id) return null;
  return {
    id,
    name: model.display_name || model.displayName || id,
    provider: model.provider,
    isLatest: !!model.is_latest,
    contextLength: model.max_token_count ?? model.maxTokenCount,
    maxOutputTokens: model.max_output_tokens ?? model.maxOutputTokens,
    supportsTools: !!model.supports_tools,
    supportsImages: !!model.supports_images,
    supportsThinking: !!model.supports_thinking,
    isDisabled: !!model.is_disabled,
  };
}

/** Live catalog for one credential, cached for an hour and coalesced per credential. */
export async function resolveZedModels(credentials, options = {}) {
  if (!credentials?.accessToken) return null;
  const key = credentialKey(credentials, credentials?.providerSpecificData?.organizationId || "");
  const cached = modelCache.get(key);
  if (!options.forceRefresh && cached && cached.expiresAt > Date.now()) return cached;
  const existing = modelInflight.get(key);
  if (existing && !options.forceRefresh) return existing;

  const promise = (async () => {
    const response = await zedLlmFetch(credentials, "/models", {
      ...options,
      fetchOptions: { method: "GET", headers: { Accept: "application/json", [ZED_HEADERS.clientSupportsXai]: "true" } },
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new ZedHostedError(response.status, `zed_hosted_http_${response.status}`, `Zed models failed: ${response.status} ${text}`.slice(0, 512));
    }
    const data = await response.json();
    const rawModels = Array.isArray(data?.models) ? data.models : [];
    const rawById = new Map();
    for (const raw of rawModels) {
      const id = normalizeZedModelId(raw?.id);
      if (id) rawById.set(id, raw);
    }
    const entry = {
      expiresAt: Date.now() + MODEL_CACHE_TTL_MS,
      models: rawModels.map(mapZedModel).filter((model) => model && !model.isDisabled),
      rawById,
      defaultModel: normalizeZedModelId(data?.default_model ?? data?.defaultModel),
    };
    modelCache.set(key, entry);
    return entry;
  })();
  modelInflight.set(key, promise);
  try {
    return await promise;
  } finally {
    if (modelInflight.get(key) === promise) modelInflight.delete(key);
  }
}

/** Model discovery for the dashboard: honors the opt-in and returns OpenAI-style rows. */
export async function discoverZedHostedModels(credentials, options = {}) {
  if (!zedHostedOptIn(credentials)) throw zedDispatchDisabledError();
  const catalog = await resolveZedModels(credentials, { ...options, forceRefresh: options.forceRefresh });
  return (catalog?.models || []).map((model) => ({ id: model.id, name: model.name, owned_by: "zed-hosted" }));
}

export function clearZedCaches() {
  llmTokenCache.clear();
  modelCache.clear();
  modelInflight.clear();
}
