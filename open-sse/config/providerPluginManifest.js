import { isFunction, isNumber } from "@/shared/utils/typeChecks.js";const SIDECAR_COMPATIBLE_EXECUTORS = new Set(["default"]);

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined)
  );
}

function resolveAuth(entry) {
  const transportAuth = entry.transport?.auth || {};
  const isNoAuth = entry.noAuth === true;
  const type =
  entry.authType || (
  isNoAuth ?
  "none" :
  entry.hasOAuth || entry.oauth || entry.authModes?.includes("oauth") ?
  "oauth" :
  "apikey");
  const header =
  transportAuth.header ||
  transportAuth.apiKey?.header || (
  entry.transport?.format === "claude" ? "x-api-key" : "Authorization");
  const authScheme = transportAuth.scheme ?? transportAuth.apiKey?.scheme;
  const authPrefix = transportAuth.prefix ?? transportAuth.apiKey?.prefix;
  const prefix = authScheme === "bearer" ? "Bearer" : authPrefix;
  return compactObject({ type, header, prefix });
}

function resolveExecutor(entry) {
  return entry.transport?.executor || entry.executor || "default";
}

function mapModel(model) {
  return compactObject({
    id: model.id,
    name: model.name,
    contextLength: model.contextLength,
    maxOutputTokens: model.maxOutputTokens,
    toolCalling: model.toolCalling,
    supportsReasoning: model.supportsReasoning,
    supportsVision: model.supportsVision,
    unsupportedParams: model.unsupportedParams,
    targetFormat: model.targetFormat,
    kind: model.kind
  });
}

function sidecarEligibility(entry) {
  const reasons = [];
  const executor = resolveExecutor(entry);
  const auth = resolveAuth(entry);
  const authType = auth.type;
  const transport = entry.transport || {};
  const hasTemplatedUrl =
  transport.baseUrl && /{[^{}]+}/.test(transport.baseUrl) ||
  (transport.baseUrls || []).some((url) => /{[^{}]+}/.test(url)) ||
  transport.responsesBaseUrl && /{[^{}]+}/.test(transport.responsesBaseUrl) ||
  transport.responsesUrl && /{[^{}]+}/.test(transport.responsesUrl);
  const isGeminiLike = transport.format === "gemini" || transport.format === "gemini-tts" || transport.format === "gemini-stt";

  if (!SIDECAR_COMPATIBLE_EXECUTORS.has(executor)) reasons.push(`custom executor: ${executor}`);
  if (!["apikey", "optional", "none"].includes(authType)) reasons.push(`auth type requires JS handling: ${authType}`);
  if (!transport.baseUrl && !transport.baseUrls?.length && !transport.responsesBaseUrl && !transport.responsesUrl) {
    reasons.push("no static upstream endpoint");
  }
  if (hasTemplatedUrl) reasons.push("templated URL requires JS handling");
  if (isFunction(transport.urlBuilder)) reasons.push("dynamic URL builder");
  if (entry.oauth || entry.hasOAuth) reasons.push("oauth metadata");
  if (entry.poolConfig) reasons.push("session pool config");
  if (isGeminiLike) reasons.push("Gemini endpoint constructed at dispatch");

  return { eligible: reasons.length === 0, reasons };
}

function capabilitiesFor(entry, eligible) {
  const capabilities = new Set();
  const executor = resolveExecutor(entry);
  const authType = resolveAuth(entry).type;

  if (authType === "apikey" || authType === "optional") capabilities.add("apikey");
  if (authType === "oauth" || entry.oauth || entry.hasOAuth) capabilities.add("oauth");
  if (entry.transport?.responsesBaseUrl || entry.transport?.responsesUrl) capabilities.add("responses");
  if (entry.passthroughModels) capabilities.add("passthrough-models");
  if (executor !== "default") capabilities.add("custom-executor");
  if (eligible) capabilities.add("sidecar-candidate");

  return [...capabilities].sort();
}

export function createProviderPluginManifestEntry(entry) {
  const sidecar = sidecarEligibility(entry);
  const transport = entry.transport || {};

  return {
    id: entry.id,
    ...(entry.alias ? { alias: entry.alias } : null),
    ...(Array.isArray(entry.aliases) && entry.aliases.length ?
    { aliases: entry.aliases } : null),

    format: transport.format || "openai",
    executor: resolveExecutor(entry),
    auth: resolveAuth(entry),
    endpoints: compactObject({
      baseUrl: transport.baseUrl,
      baseUrls: transport.baseUrls,
      responsesBaseUrl: transport.responsesBaseUrl || transport.responsesUrl,
      chatPath: transport.chatPath,
      modelsUrl: transport.modelsUrl,
      headers: transport.headers ? { ...transport.headers } : undefined,
      urlSuffix: transport.urlSuffix
    }),
    capabilities: capabilitiesFor(entry, sidecar.eligible),
    passthroughModels: entry.passthroughModels === true,
    ...(isNumber(entry.defaultContextLength) ? { defaultContextLength: entry.defaultContextLength } : null),
    ...(isNumber(transport.timeoutMs) ? { timeoutMs: transport.timeoutMs } : null),
    models: (entry.models || []).map(mapModel),
    sidecar
  };
}

export function generateProviderPluginManifestFromRegistry(registry) {
  return {
    schemaVersion: 1,
    generatedFrom: "open-sse/providers/registry",
    providers: Object.values(registry).
    map(createProviderPluginManifestEntry).
    sort((a, b) => a.id.localeCompare(b.id))
  };
}

export function getProviderPluginManifestEntryFromRegistry(registry, provider) {
  const entry =
  registry[provider] ||
  Object.values(registry).find((candidate) => candidate.alias === provider);
  return entry ? createProviderPluginManifestEntry(entry) : null;
}