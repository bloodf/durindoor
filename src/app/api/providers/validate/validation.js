export function buildGenericProviderValidationHeaders(cfg, apiKey) {
  const headers = { "Content-Type": "application/json", ...(cfg.headers || {}) };
  const auth = cfg.auth;
  if (auth?.combined && auth.header) {
    headers[auth.header] = auth.scheme === "bearer" ? `Bearer ${apiKey}` : apiKey;
    return headers;
  }
  if (cfg.authHeader === "x-api-key") headers["X-API-Key"] = apiKey;
  else headers["Authorization"] = `Bearer ${apiKey}`;
  return headers;
}
