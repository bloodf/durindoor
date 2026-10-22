import { getSettings, getApiKeyById } from "@/lib/localDb";
import { errorResponse, readBoundedResponseText, sanitizeErrorMessageWithSecrets } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { proxyAwareFetch } from "open-sse/utils/proxyFetch.js";
import { getProviderCredentialsWithQuotaPreflight, resolveClientApiKey } from "../services/auth.js";
import { enforceApiKeyModelPolicy } from "../services/apiKeyPolicy.js";
import { nativeDirectSessionAllowed, nativeUsageAdmission, observeNativeResponse } from "../services/nativeUsage.js";
import { getModelInfo } from "../services/model.js";
import REGISTRY from "open-sse/providers/registry/index.js";
import { findNativeOperation, nativeOrigin } from "./nativeProviderConfig.js";
import nativeModelSlots from "open-sse/handlers/nativeModelSlots.cjs";
import { isString } from "../../shared/utils/typeChecks.js";
import { createNativeResourceOwner, readNativeResourceOwner } from "../services/nativeResourceOwners.js";
import { resolveCredentialProxyOptions } from "open-sse/services/oauthCredentialManager.js";
import { resolveResourceOwner } from "../services/resourceOwnership.js";
import { applyEdits, findNodeAtLocation, modify, parseTree } from "jsonc-parser";
import { getBillingEpoch } from "@/lib/db/repos/usageRepo.js";
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
  const billingEpoch = auth.billingEpoch;

  const url = new URL(request.url);
  const queryModel = url.searchParams.get("model");
  url.searchParams.delete("model");
  const hasBody = request.method !== "GET" && request.method !== "DELETE";
  const contentType = request.headers.get("content-type") || "";
  let parsed = null;
  let multipart = null;
  let rawBody = hasBody ? request.body : null;
  let jsonBody = null;
  let jsonTree = null;
  const modelEdits = [];
  if (hasBody && contentType.includes("application/json")) {
    try {
      jsonBody = await request.clone().text();
      parsed = JSON.parse(jsonBody);
      jsonTree = parseTree(jsonBody);
    } catch { return fail(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body"); }
  } else if (hasBody && contentType.includes("multipart/form-data") && operation.kind !== "file") {
    try { multipart = await request.clone().formData(); } catch { return fail(HTTP_STATUS.BAD_REQUEST, "Invalid multipart body"); }
    const value = multipart.get("model");
    parsed = isString(value) ? { model: value } : null;
  }
  let slots;
  try { slots = collectNativeModelSlots(parsed, operation.kind); } catch { return fail(HTTP_STATUS.BAD_REQUEST, "Invalid native model fields"); }
  const suppliedModel = queryModel || slots[0]?.holder?.[slots[0]?.key] || null;
  if (!suppliedModel || !isString(suppliedModel)) {
    return fail(HTTP_STATUS.BAD_REQUEST, "Missing gateway model identity");
  }
  const identities = [
    ...(queryModel ? [{ holder: null, key: null, value: queryModel, primary: true }] : []),
    ...slots,
  ];
  let model = null;
  for (const slot of identities) {
    const rawIdentity = slot.value || slot.holder[slot.key];
    if (!isString(rawIdentity) || !rawIdentity) return fail(HTTP_STATUS.BAD_REQUEST, "Mixed model identities");
    const identity = rawIdentity.includes("/") ? rawIdentity : `${provider}/${rawIdentity}`;
    const resolved = await getModelInfo(identity);
    if (!resolved.provider || resolved.provider !== provider || !resolved.model) return fail(HTTP_STATUS.BAD_REQUEST, "Model does not belong to native provider");
    const registryProvider = REGISTRY.find((entry) => entry.id === provider || entry.alias === provider || entry.aliases?.includes(provider));
    const registryModel = registryProvider?.models?.find((entry) => entry.id === resolved.model || entry.aliases?.includes(resolved.model));
    if (!registryModel) return fail(HTTP_STATUS.BAD_REQUEST, "Unknown native provider model");
    if (registryModel?.routingUnavailableReason) return fail(HTTP_STATUS.BAD_REQUEST, registryModel.routingUnavailableReason);
    if (operation.kind === "documentParsing" && registryModel?.kind !== "documentParsing") {
      return fail(HTTP_STATUS.BAD_REQUEST, "Model does not support native document parsing");
    }
    const canonicalIdentity = `${provider}/${resolved.model}`;
    const policyError = await enforceApiKeyModelPolicy(request, canonicalIdentity, apiKey, { limits: false });
    if (policyError) return policyError;
    if (slot.primary) {
      if (model && model !== resolved.model) return fail(HTTP_STATUS.BAD_REQUEST, "Mixed model identities");
      model = resolved.model;
    } else if (!model) {
      model = resolved.model;
    }
    if (slot.holder) {
      if (jsonTree) {
        const holderNode = findNodeAtLocation(jsonTree, slot.path.slice(0, -1));
        if (holderNode?.children?.filter((property) => property.children?.[0]?.value === slot.key).length !== 1) {
          return fail(HTTP_STATUS.BAD_REQUEST, "Ambiguous native model field");
        }
        const node = findNodeAtLocation(jsonTree, slot.path);
        modelEdits.push({ offset: node.offset, length: node.length, content: JSON.stringify(resolved.model) });
      }
      slot.holder[slot.key] = resolved.model;
    }
  }
  const dispatchInference = !operation.accountBound && !["file", "realtime", "realtime-translation", "realtime-transcription", "live"].includes(operation.kind);
  const observeCompletion = operation.completionPoll === true;
  if ((parsed?.background === true || operation.kind === "batches" && request.method === "POST" && !operation.accountBound) &&
    !await nativeDirectSessionAllowed(apiKey)) {
    return fail(HTTP_STATUS.FORBIDDEN, "Usage-capped API keys cannot delegate native background or batch inference");
  }
  if (dispatchInference) {
    const dailyError = await nativeUsageAdmission(apiKey);
    if (dailyError) return dailyError;
    const policyError = await enforceApiKeyModelPolicy(request, `${provider}/${model}`, apiKey);
    if (policyError) return policyError;
  }
  const nativeUsageEventId = dispatchInference ? crypto.randomUUID() : null;
  const asynchronousCreation = operation.createsResource && ["task_id", "request_id"].includes(operation.resourceResponseField) || parsed?.background === true;
  if (["realtime", "realtime-translation", "realtime-transcription", "live"].includes(operation.kind) &&
    !await nativeDirectSessionAllowed(apiKey)) {
    return fail(HTTP_STATUS.FORBIDDEN, "Usage-capped API keys cannot mint direct native sessions");
  }
  const trackedResource = operation.resourceParam || operation.resourceQuery || operation.resourceBodyField;
  const requestOwner = operation.createsResource || trackedResource ? await resolveResourceOwner(request) : null;
  if (operation.createsResource && (!requestOwner?.authorized || !requestOwner.ownerId)) return fail(HTTP_STATUS.FORBIDDEN, "Native resource ownership requires an API key");
  if (multipart) {
    if (parsed?.model) multipart.set("model", parsed.model);
    if (provider === "xai" && model === "stt") multipart.delete("model");
    if (provider === "xai" && operation.kind === "stt") {
      const ordered = new FormData();
      for (const [name, value] of multipart) if (name !== "file") ordered.append(name, value);
      for (const value of multipart.getAll("file")) ordered.append("file", value);
      multipart = ordered;
    }
    rawBody = multipart;
  } else if (jsonBody !== null) {
    rawBody = applyEdits(jsonBody, modelEdits);
    if (["openai", "minimax", "minimax-cn"].includes(provider) && operation.kind === "chat" && parsed?.stream === true) {
      rawBody = applyEdits(rawBody, modify(rawBody, ["stream_options", "include_usage"], true, {}));
    }
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
  const pathParts = path.split("/").filter(Boolean);
  const patternParts = operation.path.split("/").filter(Boolean);
  const resourceIndex = operation.resourceParam ? patternParts.findIndex((part) => part === `{${operation.resourceParam}}`) : -1;
  const bodyResourceNode = operation.resourceBodyField && jsonTree ? findNodeAtLocation(jsonTree, [operation.resourceBodyField]) : null;
  const bodyResourceId = bodyResourceNode?.type === "number" ? jsonBody.slice(bodyResourceNode.offset, bodyResourceNode.offset + bodyResourceNode.length) : parsed?.[operation.resourceBodyField];
  const pollResourceId = operation.resourceParam ? pathParts[resourceIndex] : operation.resourceQuery ? url.searchParams.get(operation.resourceQuery) : bodyResourceId;
  if (trackedResource && (!isString(pollResourceId) || !pollResourceId)) return fail(HTTP_STATUS.BAD_REQUEST, "Missing native resource ID");
  const resourceOwner = trackedResource ? await readNativeResourceOwner(provider, credentials.connectionId, pollResourceId) : null;
  if (trackedResource && !resourceOwner) return fail(HTTP_STATUS.FORBIDDEN, "Unknown native resource owner");
  if (resourceOwner && !requestOwner.allowAllOwners && resourceOwner.ownerId !== requestOwner.ownerId) return fail(HTTP_STATUS.FORBIDDEN, "Forbidden");
  if (resourceOwner?.model && resourceOwner.model !== model) return fail(HTTP_STATUS.BAD_REQUEST, "Native resource model does not match its creation model");
  // Completion must have durable creation identity before any upstream work.
  if (observeCompletion && (!isString(resourceOwner?.usageEventId) || !resourceOwner.usageEventId.trim())) {
    return fail(HTTP_STATUS.FORBIDDEN, "Native resource billing identity is unavailable");
  }
  const keyedCreator = resourceOwner && !["local", "operator"].includes(resourceOwner.ownerId);
  const creator = observeCompletion && keyedCreator ? await getApiKeyById(resourceOwner.ownerId) : null;
  if (observeCompletion && keyedCreator && !creator?.key) return fail(HTTP_STATUS.FORBIDDEN, "Native resource creator key is no longer available");
  const secret = credentials.apiKey || credentials.accessToken;
  if (!secret) return fail(HTTP_STATUS.SERVICE_UNAVAILABLE, "Provider account unavailable");

  const headers = new Headers();
  for (const [name, value] of request.headers) if (FORWARD_HEADERS.has(name.toLowerCase())) headers.set(name, value);
  if (operation.auth === "x-api-key" || provider === "anthropic") headers.set("x-api-key", secret);
  else headers.set("authorization", `Bearer ${secret}`);
  headers.set("accept-encoding", "identity");
  const upstream = new URL(path, origin);
  for (const [name, value] of url.searchParams) upstream.searchParams.append(name, value);
  // Polls retain the creation generation, not the polling caller's fresh stamp.
  const operationBillingEpoch = resourceOwner ? resourceOwner.billingEpoch : billingEpoch;
  if ((operationBillingEpoch ?? null) !== await getBillingEpoch()) {
    return fail(HTTP_STATUS.FORBIDDEN, "Stale or missing billing epoch");
  }
  let response;
  try {
    response = await proxyAwareFetch(upstream, { method: request.method, headers, body: rawBody, signal: request.signal, redirect: "error", duplex: rawBody ? "half" : undefined }, resolveCredentialProxyOptions(credentials));
  } catch {
    return fail(HTTP_STATUS.BAD_GATEWAY, "Native provider request failed");
  }
  if (!response.ok) return forwardError(response, credentials);
  let createdResourceId = null;
  const responseHeaders = new Headers();
  for (const name of ["content-type", "content-disposition", "x-request-id"]) {
    const value = response.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  responseHeaders.set("Access-Control-Allow-Origin", "*");
  responseHeaders.set("Cache-Control", "no-store");
  response = new Response(response.body, { status: response.status, statusText: response.statusText, headers: responseHeaders });
  if (dispatchInference || observeCompletion || operation.createsResource) {
    response = observeNativeResponse(response, {
      apiKey: resourceOwner ? creator?.key : apiKey, provider, model: resourceOwner?.model || model, connectionId: credentials.connectionId, endpoint: path,
      // Creation and completion polls share one operation ID, never a reusable resource ID.
      terminalOnly: observeCompletion || asynchronousCreation,
      usageEventId: observeCompletion ? resourceOwner?.usageEventId : nativeUsageEventId,
      billingEpoch: operationBillingEpoch,
      modality: operation.kind, tokens: dispatchInference || observeCompletion ? {} : null, nativeUnits: {},
      cost: null, costStatus: "unknown", costSource: "provider-cost-unavailable",
      onValue: operation.createsResource ? async (metadata) => {
        const field = operation.resourceResponseField || operation.resourceResponsePath?.at(-1);
        const resourceId = metadata?.[field];
        if (!resourceId || createdResourceId) return;
        if (!isString(resourceId)) throw new Error("Native resource ownership could not be recorded");
        await createNativeResourceOwner({ ownerId: requestOwner.ownerId, provider, model, connectionId: credentials.connectionId, resourceId, usageEventId: nativeUsageEventId, billingEpoch });
        createdResourceId = resourceId;
      } : null,
      onEnd: operation.createsResource ? () => {
        if (!createdResourceId) throw new Error("Native resource response omitted its ownership ID");
      } : null
    });
  }
  return operation.returnsConnection ? connectionHeader(response, credentials.connectionId) : response;
}

export function handleOpenAINativeSession(request, path) {
  return handleNativeProvider(request, "openai", path);
}
