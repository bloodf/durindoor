const SIDECAR_COMPATIBLE_EXECUTORS = new Set(["default"]);

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined)
  );
}

function resolveAuth(entry) {
  const transportAuth = entry.transport?.auth || {};
  const isNoAuth = entry.noAuth === true;
  const type =
    entry.authType ||
    (isNoAuth
      ? "none"
      : entry.hasOAuth || entry.oauth || entry.authModes?.includes("oauth")
        ? "oauth"
        : "apikey");
  const header =
    transportAuth.header ||
    (entry.transport?.format === "claude" ? "x-api-key" : "Authorization");
  const prefix =
    transportAuth.scheme === "bearer" ? "Bearer" : transportAuth.prefix;
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
    kind: model.kind,
  });
}

function sidecarEligibility(entry) {
  const reasons = [];
  const executor = resolveExecutor(entry);
  const authType = resolveAuth(entry).type;
  const hasTemplatedUrl =
    (entry.transport?.baseUrl && /{[^{}]+}/.test(entry.transport.baseUrl)) ||
    (entry.transport?.baseUrls || []).some((url) => /{[^{}]+}/.test(url)) ||
    (entry.transport?.responsesBaseUrl && /{[^{}]+}/.test(entry.transport.responsesBaseUrl)) ||
    (entry.transport?.responsesUrl && /{[^{}]+}/.test(entry.transport.responsesUrl));

  if (!SIDECAR_COMPATIBLE_EXECUTORS.has(executor)) reasons.push(`custom executor: ${executor}`);
  if (!["apikey", "optional", "none"].includes(authType)) reasons.push(`auth type requires JS handling: ${authType}`);
  if (!entry.transport?.baseUrl && !entry.transport?.baseUrls?.length && !entry.transport?.responsesBaseUrl && !entry.transport?.responsesUrl) {
    reasons.push("no static upstream endpoint");
  }
  if (hasTemplatedUrl) reasons.push("templated URL requires JS handling");
  if (typeof entry.transport?.urlBuilder === "function") reasons.push("dynamic URL builder");
  if (entry.oauth || entry.hasOAuth) reasons.push("oauth metadata");
  if (entry.poolConfig) reasons.push("session pool config");

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
    ...(entry.alias ? { alias: entry.alias } : {}),
    ...(Array.isArray(entry.aliases) && entry.aliases.length
      ? { aliases: entry.aliases }
      : {}),
    format: transport.format || "openai",
    executor: resolveExecutor(entry),
    auth: resolveAuth(entry),
    endpoints: compactObject({
      baseUrl: transport.baseUrl,
      baseUrls: transport.baseUrls,
      responsesBaseUrl: transport.responsesBaseUrl || transport.responsesUrl,
      chatPath: transport.chatPath,
      modelsUrl: transport.modelsUrl,
    }),
    capabilities: capabilitiesFor(entry, sidecar.eligible),
    passthroughModels: entry.passthroughModels === true,
    ...(typeof entry.defaultContextLength === "number" ? { defaultContextLength: entry.defaultContextLength } : {}),
    ...(typeof transport.timeoutMs === "number" ? { timeoutMs: transport.timeoutMs } : {}),
    models: (entry.models || []).map(mapModel),
    sidecar,
  };
}

export function generateProviderPluginManifestFromRegistry(registry) {
  return {
    schemaVersion: 1,
    generatedFrom: "open-sse/providers/registry",
    providers: Object.values(registry)
      .map(createProviderPluginManifestEntry)
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
}

export function getProviderPluginManifestEntryFromRegistry(registry, provider) {
  const entry =
    registry[provider] ||
    Object.values(registry).find((candidate) => candidate.alias === provider);
  return entry ? createProviderPluginManifestEntry(entry) : null;
}
