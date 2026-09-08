// Runs only in a fresh child with no inherited credentials or user data. The
// browser guard disables registry background jobs; attempted network use fails
// the projection even if a registry module catches the thrown error.
async function projectCatalog(projectRoot) {
  const { default: net } = await import("node:net");
  const { pathToFileURL } = await import("node:url");
  let networkAttempts = 0;
  const denyNetwork = () => { networkAttempts += 1; throw new Error("Provider metadata attempted network access"); };
  globalThis.window = {};
  globalThis.fetch = denyNetwork;
  net.Socket.prototype.connect = denyNetwork;
  const { isString, isBoolean, isNumber, isObject } = await import(pathToFileURL(`${projectRoot}/src/shared/utils/typeChecks.js`).href);
  const fields = new Set([
    "id", "category", "alias", "uiAlias", "aliases", "display", "hidden", "priority",
    "hasFree", "thinkingConfig", "regions", "defaultRegion", "hasProviderSpecificData", "noAuth",
    "passthroughModels", "passthroughConnectionWideErrors", "hasOAuth", "authModes", "authType",
    "authHint", "features", "media", "serviceKinds", "ttsConfig", "sttConfig", "embeddingConfig",
    "imageConfig", "imageToTextConfig", "videoConfig", "musicConfig", "searchViaChat", "searchConfig",
    "fetchConfig", "modelsFetcher", "mediaPriority", "hiddenKinds", "models",
    "thinkingFormat", "capabilities", "quirks", "requestDefaults",
  ]);
  const forbidden = new Set(["headers", "header", "authorization", "cookie", "credentials", "clientId", "clientSecret", "tokenUrl", "apiKey", "authHeader", "proxy", "agent", "userAgent"]);
  const dataProperty = (value, key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) return undefined;
    if (!("value" in descriptor)) throw new Error(`Provider metadata accessor: ${key}`);
    return descriptor.value;
  };
  const plain = (value) => {
    if (value === undefined || value === null || isString(value) || isBoolean(value)) return value;
    if (isNumber(value) && Number.isFinite(value)) return value;
    if (Array.isArray(value)) return value.map(plain);
    if (!isObject(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error("Provider metadata contains executable/non-JSON data");
    return Object.fromEntries(Object.keys(value).sort().filter((key) => !forbidden.has(key)).flatMap((key) => {
      const item = plain(dataProperty(value, key));
      return item === undefined ? [] : [[key, item]];
    }));
  };
  const [{ default: registry }, { PROVIDER_MODELS, PROVIDERS, PROVIDER_MEDIA }] = await Promise.all([
    import(pathToFileURL(`${projectRoot}/open-sse/providers/registry/index.js`).href),
    import(pathToFileURL(`${projectRoot}/open-sse/providers/index.js`).href),
  ]);
  const publicTransport = (config) => Object.fromEntries(["baseUrl", "format", "thinkingFormat", "defaultContextLength", "regions", "defaultRegion", "requestDefaults", "quirks"].flatMap((key) => {
    const value = plain(dataProperty(config, key));
    return value === undefined ? [] : [[key, value]];
  }));
  const projected = registry.map((entry) => {
    const result = Object.fromEntries(Object.keys(entry).sort().filter((key) => fields.has(key)).flatMap((key) => {
      const item = plain(dataProperty(entry, key));
      return item === undefined ? [] : [[key, item]];
    }));
    const oauth = dataProperty(entry, "oauth");
    if (oauth?.flowType !== undefined) result.oauth = { flowType: plain(dataProperty(oauth, "flowType")) };
    const transport = dataProperty(entry, "transport");
    if (transport) result.transport = publicTransport(transport);
    return result;
  });
  const providers = Object.fromEntries(Object.entries(PROVIDERS).map(([id, config]) => {
    const value = publicTransport(config);
    if (config.transports) value.transports = config.transports.map(publicTransport);
    return [id, value];
  }));
  if (networkAttempts) throw new Error(`Provider metadata attempted ${networkAttempts} network operations`);
  process.stdout.write(`\nDURIN_UI_METADATA ${JSON.stringify({ registry: projected, models: plain(PROVIDER_MODELS), providers, media: plain(PROVIDER_MEDIA), oauth: Object.fromEntries(projected.filter((entry) => entry.oauth).map((entry) => [entry.id, entry.oauth])) })}\n`);
}
await projectCatalog(process.argv[2]);
