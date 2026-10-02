import { getSettings } from "@/lib/localDb";
import { errorResponse, readBoundedResponseText, sanitizeErrorMessageWithSecrets } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { proxyAwareFetch } from "open-sse/utils/proxyFetch.js";
import { getProviderCredentialsWithQuotaPreflight, resolveClientApiKey } from "../services/auth.js";
import { enforceApiKeyModelPolicy } from "../services/apiKeyPolicy.js";
import { getModelInfo } from "../services/model.js";
import REGISTRY from "open-sse/providers/registry/index.js";
import { findNativeOperation, nativeOrigin } from "./nativeProviderConfig.js";
import nativeModelSlots from "open-sse/handlers/nativeModelSlots.cjs";
const { collectNativeModelSlots } = nativeModelSlots;

const MAX_ERROR_BYTES = 8192;
const FORWARD_HEADERS = new Set(["accept", "content-type", "anthropic-version", "anthropic-beta", "anthropic-workspace-id", "idempotency-key", "openai-beta", "x-client-request-id"]);

function fail(status, message) {
  return errorResponse(status, message);
}


function connectionHeader(response, connectionId) {
  const headers = new Headers(response.headers);
  headers.set("x-9router-connection-id", String(connectionId));
  headers.set("Access-Control-Expose-Headers", "x-9router-connection-id");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function forwardError(response, credentials) {
  const text = await readBoundedResponseText(response, { maxBytes: MAX_ERROR_BYTES });
  let message = text || `Native provider returned HTTP ${response.status}`;
  try {
    const parsed = JSON.parse(text);
    message = parsed.error?.message || parsed.message || parsed.base_resp?.status_msg || message;
  } catch { /* Non-JSON errors still pass through the common secret redactor. */ }
  return errorResponse(response.status, sanitizeErrorMessageWithSecrets(message,
    [credentials.apiKey, credentials.accessToken, credentials.refreshToken, credentials.providerSpecificData?.connectionProxyUrl]));
}

/** Native vendor operation proxy. Only configured methods and paths can reach fixed vendor origins. */
export async function handleNativeProvider(request, provider, path) {
  const operation = findNativeOperation(provider, request.method, path);
  if (!operation) return fail(HTTP_STATUS.NOT_FOUND, "Unknown native operation");
  const origin = nativeOrigin(provider);
  if (!origin) return fail(HTTP_STATUS.BAD_REQUEST, "Unknown provider");

  const settings = await getSettings();
  const { apiKey, auth } = await resolveClientApiKey(request, { required: settings.requireApiKey === true });
  if (!auth.ok) return fail(HTTP_STATUS.UNAUTHORIZED, auth.reason === "missing" ? "Missing API key" : "Invalid API key");

  const url = new URL(request.url);
  const queryModel = url.searchParams.get("model");
  url.searchParams.delete("model");
  const hasBody = request.method !== "GET" && request.method !== "DELETE";
  const contentType = request.headers.get("content-type") || "";
  let parsed = null;
  let multipart = null;
  let rawBody = hasBody ? request.body : null;
  if (hasBody && contentType.includes("application/json")) {
    try { parsed = await request.json(); } catch { return fail(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body"); }
  } else if (hasBody && contentType.includes("multipart/form-data") && operation.kind !== "file") {
    try { multipart = await request.formData(); } catch { return fail(HTTP_STATUS.BAD_REQUEST, "Invalid multipart body"); }
    const value = multipart.get("model");
    parsed = typeof value === "string" ? { model: value } : null;
  }
  const slots = collectNativeModelSlots(parsed, operation.kind);
  const suppliedModel = queryModel || slots[0]?.holder?.[slots[0]?.key] || null;
  if (!suppliedModel || typeof suppliedModel !== "string") {
    return fail(HTTP_STATUS.BAD_REQUEST, "Missing gateway model identity");
  }
  const identities = [
    ...(queryModel ? [{ holder: null, key: null, value: queryModel }] : []),
    ...slots,
  ];
  let model = null;
  for (const slot of identities) {
    const rawIdentity = slot.value || slot.holder[slot.key];
    if (typeof rawIdentity !== "string" || !rawIdentity) return fail(HTTP_STATUS.BAD_REQUEST, "Mixed model identities");
    const identity = rawIdentity.includes("/") ? rawIdentity : `${provider}/${rawIdentity}`;
    const resolved = await getModelInfo(identity);
    if (!resolved.provider || resolved.provider !== provider || !resolved.model) return fail(HTTP_STATUS.BAD_REQUEST, "Model does not belong to native provider");
    const registryProvider = REGISTRY.find((entry) => entry.id === provider || entry.alias === provider || entry.aliases?.includes(provider));
    const registryModel = registryProvider?.models?.find((entry) => entry.id === resolved.model || entry.aliases?.includes(resolved.model));
    if (registryModel?.routingUnavailableReason) return fail(HTTP_STATUS.BAD_REQUEST, registryModel.routingUnavailableReason);
    const canonicalIdentity = `${provider}/${resolved.model}`;
    const policyError = await enforceApiKeyModelPolicy(request, canonicalIdentity, apiKey);
    if (policyError) return policyError;
    if (slot.value || slot.primary) {
      if (model && model !== resolved.model) return fail(HTTP_STATUS.BAD_REQUEST, "Mixed model identities");
      model = resolved.model;
    } else if (!model) {
      model = resolved.model;
    }
    if (slot.holder) slot.holder[slot.key] = resolved.model;
  }
  if (multipart) {
    if (parsed?.model) multipart.set("model", parsed.model);
    if (provider === "xai" && model === "stt") multipart.delete("model");
    // xAI reads option fields while streaming the file; the file must be last.
    if (provider === "xai" && operation.kind === "stt") {
      const ordered = new FormData();
      for (const [name, value] of multipart) if (name !== "file") ordered.append(name, value);
      for (const value of multipart.getAll("file")) ordered.append("file", value);
      multipart = ordered;
    }
    rawBody = multipart;
  } else if (parsed !== null) {
    rawBody = JSON.stringify(parsed);
  }

  const pinnedConnectionId = request.headers.get("x-connection-id");
  if (operation.accountBound && !pinnedConnectionId) return fail(HTTP_STATUS.BAD_REQUEST, "x-connection-id is required for account-bound operation");
  const credentials = await getProviderCredentialsWithQuotaPreflight(provider, null, model, {
    apiKeyId: auth.apiKeyId,
    preferredConnectionId: pinnedConnectionId || null,
    strictConnectionId: pinnedConnectionId || null,
    signal: request.signal,
  });
  if (!credentials || credentials.allRateLimited || credentials.providerDisabled || (pinnedConnectionId && credentials.connectionId !== pinnedConnectionId)) {
    return fail(credentials?.providerDisabled ? HTTP_STATUS.FORBIDDEN : HTTP_STATUS.SERVICE_UNAVAILABLE, "Provider account unavailable");
  }
  const secret = credentials.apiKey || credentials.accessToken;
  if (!secret) return fail(HTTP_STATUS.SERVICE_UNAVAILABLE, "Provider account unavailable");

  const headers = new Headers();
  for (const [name, value] of request.headers) if (FORWARD_HEADERS.has(name.toLowerCase())) headers.set(name, value);
  if (multipart) headers.delete("content-type");
  if (operation.auth === "x-api-key" || provider === "anthropic") headers.set("x-api-key", secret);
  else headers.set("authorization", `Bearer ${secret}`);
  headers.set("accept-encoding", "identity");
  const upstream = new URL(path, origin);
  for (const [name, value] of url.searchParams) upstream.searchParams.append(name, value);
  let response;
  try {
    response = await proxyAwareFetch(upstream, { method: request.method, headers, body: rawBody, signal: request.signal, redirect: "error", duplex: rawBody ? "half" : undefined }, credentials.providerSpecificData);
  } catch {
    return fail(HTTP_STATUS.BAD_GATEWAY, "Native provider request failed");
  }
  if (!response.ok) return forwardError(response, credentials);
  const responseHeaders = new Headers();
  for (const name of ["content-type", "content-disposition", "x-request-id"]) {
    const value = response.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  responseHeaders.set("Access-Control-Allow-Origin", "*");
  responseHeaders.set("Cache-Control", "no-store");
  response = new Response(response.body, { status: response.status, statusText: response.statusText, headers: responseHeaders });
  return operation.returnsConnection ? connectionHeader(response, credentials.connectionId) : response;
}

export function handleOpenAINativeSession(request, path) {
  return handleNativeProvider(request, "openai", path);
}
