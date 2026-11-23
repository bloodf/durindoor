import { BaseExecutor } from "./base.js";
import { isString } from "../../src/shared/utils/typeChecks.js";
import { PROVIDERS } from "../config/providers.js";
import { getModelMeta } from "../config/providerModels.js";
import { parseVertexSaJson, refreshVertexToken, refreshGoogleToken, classifyVertexCredential, VERTEX_CREDENTIAL } from "../services/tokenRefresh.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { digestMemoryKey } from "../utils/memoryKey.js";
import { proxyRouteFingerprint } from "../services/tokenRefresh/dedup.js";
import { getCurrentProviderAttemptTimestamp } from "../services/providerAttemptContext.js";
import { runQuotaBearingProviderRequest } from "../services/providerAttemptContext.js";
import { FETCH_CONNECT_TIMEOUT_MS } from "../config/runtimeConfig.js";

// Cache project IDs resolved from raw API keys { apiKey → projectId }
const projectIdCache = new Map();

/**
 * Resolve the Google credential a connection carries.
 *
 * Service Account JSON, ADC `authorized_user` JSON and opaque Express-mode API
 * keys are all supported. A JSON document that is none of those is rejected
 * here instead of being demoted to a raw API key: a raw key travels in the URL
 * query string, so the demotion would put a private key, a client secret or a
 * refresh token into the outbound URL and in front of the egress proxy.
 */
function resolveVertexCredential(apiKey) {
  const credential = classifyVertexCredential(apiKey);
  if (credential.error) throw new Error(credential.error);
  const saJson = credential.kind === VERTEX_CREDENTIAL.SERVICE_ACCOUNT ? credential.json : null;
  const adcJson = credential.kind === VERTEX_CREDENTIAL.ADC ? credential.json : null;
  return { credential, saJson, adcJson };
}

/**
 * Resolve GCP project ID from a raw Vertex API key.
 * Sends a dummy 404 request and parses "projects/{id}" from the error message.
 */
async function resolveProjectId(apiKey, proxyOptions, signal) {
  const cacheKey = digestMemoryKey("vertex-project", apiKey, proxyRouteFingerprint(proxyOptions));
  if (projectIdCache.has(cacheKey)) return projectIdCache.get(cacheKey);

  const url = new URL("https://aiplatform.googleapis.com/v1/publishers/google/models/__probe__:generateContent");
  url.searchParams.set("key", apiKey);
  let projectId = null;
  try {
    const res = await proxyAwareFetch(url.toString(), {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", signal, redirect: "error"
    }, proxyOptions);
    const json = await res.json().catch(() => null);
    const msg = json?.[0]?.error?.message || json?.error?.message || "";
    const match = isString(msg) ? msg.slice(0, 4096).match(/projects\/([a-z][a-z0-9-]{4,28}[a-z0-9])\//) : null;
    projectId = match?.[1] || null;
  } catch {
    if (signal?.aborted) throw signal.reason;
    throw new Error("Vertex: project discovery request failed");
  }
  if (projectId) {
    if (projectIdCache.size >= 256) projectIdCache.delete(projectIdCache.keys().next().value);
    projectIdCache.set(cacheKey, projectId);
  }
  return projectId;
}

/**
 * VertexExecutor - Google Cloud Vertex AI
 *
 * "vertex"         → Gemini models via regional/global Vertex endpoint
 * "vertex-partner" → Partner models (Llama, Mistral, GLM, DeepSeek, Qwen)
 *                    via global OpenAI-compatible endpoint
 *
 * Auth: SA JSON (stored as apiKey) → JWT assertion → Bearer token (via jose)
 * Token is minted/cached in tokenRefresh.js, not here.
 */
// US and EU multi-regions require the matching representative host and /locations/<region> path.
function vertexLocationBase(projectId, location) {
  const host = location === "eu" || location === "us" ? `aiplatform.${location}.rep.googleapis.com` : "aiplatform.googleapis.com";
  return `https://${host}/v1/projects/${projectId}/locations/${location}`;
}

export class VertexExecutor extends BaseExecutor {
  constructor(providerId = "vertex") {
    super(providerId, PROVIDERS[providerId] || {});
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    const { saJson, adcJson } = resolveVertexCredential(credentials?.apiKey);
    const usesOAuth = !!saJson || !!adcJson || !!credentials?.accessToken;
    const rawKey = !usesOAuth ? credentials?.apiKey : null;
    const projectId =
    saJson?.project_id ||
    adcJson?.quota_project_id ||
    credentials?.providerSpecificData?.projectId;

    if (this.provider === "vertex-partner") {
      // Partner models require project_id in path regardless of auth method
      if (!projectId) throw new Error("Vertex partner models require a project_id. Add it in providerSpecificData or use Service Account JSON.");
      const url = `https://aiplatform.googleapis.com/v1/projects/${projectId}/locations/global/endpoints/openapi/chat/completions`;
      return rawKey ? `${url}?key=${encodeURIComponent(rawKey)}` : url;
    }

    // Gemini on Vertex
    const action = stream ? "streamGenerateContent" : "generateContent";
    const defaultLocation = getModelMeta(this.provider, model)?.defaultLocation || null;

    if (usesOAuth) {
      // SA JSON / ADC / pre-set accessToken: must use project-scoped path to avoid RESOURCE_PROJECT_INVALID
      if (!projectId) {
        throw new Error(
          "Vertex OAuth/ADC requires a project_id. " +
          "Add quota_project_id to your ADC JSON or set providerSpecificData.projectId."
        );
      }
      // Global-only models (registry defaultLocation, e.g. Argon) must not
      // fall back to a regional location (upstream 9router 29fc880e).
      const location = credentials?.providerSpecificData?.location || defaultLocation || "us-central1";
      let url = `${vertexLocationBase(projectId, location)}/publishers/google/models/${model}:${action}`;
      if (stream) url += "?alt=sse";
      return url;
    }

    // Raw API keys stay on the projectless publishers endpoint, except models
    // that are only served from multi-regions (registry defaultLocation, e.g.
    // Argon): with an explicit project those honor its location, defaulting to
    // the model's (upstream 9router 9c141910, narrowed to those models).
    // ?alt=sse is required for proper SSE streaming (matches every other Gemini executor)
    const keyProjectId = credentials?.providerSpecificData?.projectId;
    let url = keyProjectId && defaultLocation ?
    `${vertexLocationBase(keyProjectId, credentials?.providerSpecificData?.location || defaultLocation)}/publishers/google/models/${model}:${action}` :
    `https://aiplatform.googleapis.com/v1/publishers/google/models/${model}:${action}`;
    if (stream) url += "?alt=sse";
    if (rawKey) url += stream ? `&key=${encodeURIComponent(rawKey)}` : `?key=${encodeURIComponent(rawKey)}`;
    return url;
  }

  buildHeaders(credentials, stream = true) {
    const headers = { "Content-Type": "application/json" };

    // Only set Bearer token if using SA JSON flow (raw key goes in URL ?key=)
    if (credentials.accessToken) {
      headers["Authorization"] = `Bearer ${credentials.accessToken}`;
    }

    if (stream) headers["Accept"] = "text/event-stream";

    return headers;
  }

  async refreshCredentials(credentials, log, proxyOptions = null) {
    const saJson = parseVertexSaJson(credentials?.apiKey);
    if (!saJson) return null;

    const result = await refreshVertexToken(saJson, log, proxyOptions);
    if (!result) return null;

    return { accessToken: result.accessToken, expiresAt: result.expiresAt };
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions = null, requestContext = null }) {
    const effectiveCredentials = credentials ? { ...credentials } : credentials;
    const { saJson, adcJson } = resolveVertexCredential(effectiveCredentials?.apiKey);

    // SA JSON flow: mint Bearer token via JWT assertion (cached)
    if (saJson) {
      const result = await refreshVertexToken(saJson, log, proxyOptions);
      if (!result?.accessToken) throw new Error("Vertex: failed to mint access token from Service Account JSON");
      effectiveCredentials.accessToken = result.accessToken;
    }

    // ADC user credential flow: refresh Bearer token via Google OAuth2 token endpoint
    if (adcJson) {
      const result = await refreshGoogleToken(
        adcJson.refresh_token,
        adcJson.client_id,
        adcJson.client_secret,
        log,
        proxyOptions
      );
      if (!result?.accessToken) throw new Error("Vertex: failed to refresh access token from ADC JSON (authorized_user)");
      effectiveCredentials.accessToken = result.accessToken;
    }

    // vertex-partner with raw key: auto-resolve project_id if not provided
    if (this.provider === "vertex-partner" && !saJson && !adcJson && !effectiveCredentials?.providerSpecificData?.projectId) {
      const projectId = await resolveProjectId(effectiveCredentials.apiKey, proxyOptions, signal);
      if (!projectId) throw new Error("Vertex: could not resolve project_id from API key. Please add it manually in provider settings.");
      log?.debug?.("VERTEX", `Resolved project_id: ${projectId}`);
      effectiveCredentials.providerSpecificData = { ...effectiveCredentials.providerSpecificData, projectId };
    }

    const url = this.buildUrl(model, stream, 0, effectiveCredentials);
    const headers = this.buildHeaders(effectiveCredentials, stream);
    const transformedBody = this.clampCustomMaxOutput(
      this.transformRequest(model, body, stream, effectiveCredentials),
      requestContext
    );

    // Gemini 3/4 chat rejects trailing model turns. Preserve image models,
    // older Gemini families, partner requests, and at least one content turn.
    const baseModel = model.toLowerCase().split("/").pop();
    if (this.provider === "vertex" && !/(?:^|-)image(?:-|$)/.test(baseModel) &&
        /^gemini-(?:[34](?:\.\d+)?(?:-[a-z0-9-]+)?|pro-agent)$/.test(baseModel) &&
        Array.isArray(transformedBody.contents)) {
      const contents = [...transformedBody.contents];
      while (contents.length > 1 && contents.at(-1)?.role === "model") contents.pop();
      transformedBody.contents = contents;
    }

    const connectController = new AbortController();
    const mergedSignal = signal ? AbortSignal.any([signal, connectController.signal]) : connectController.signal;
    const connectTimer = setTimeout(() => connectController.abort(new Error("Vertex connect timeout")), this.config?.timeoutMs || FETCH_CONNECT_TIMEOUT_MS);
    let response;
    try {
      response = await runQuotaBearingProviderRequest(() => proxyAwareFetch(url, {
        method: "POST",
        headers,
        // Only the partner endpoint speaks Chat Completions; Gemini stays native.
        body: JSON.stringify(this.provider === "vertex-partner" ?
          this.prepareOpenAIToolMessagesForWire(transformedBody) : transformedBody),
        signal: mergedSignal,
        redirect: "error"
      }, proxyOptions));
    } finally {
      clearTimeout(connectTimer);
    }

    return {
      response,
      url,
      headers,
      transformedBody,
      attemptStartedAt: getCurrentProviderAttemptTimestamp(),
      terminalProvenance: "upstream"
    };
  }
}

export default VertexExecutor;
