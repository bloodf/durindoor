import { isBoolean, isNumber, isObject, isString } from "@/shared/utils/typeChecks.js";function isRecord(value) {
  return value !== null && isObject(value) && !Array.isArray(value);
}

function toJsonValue(v) {
  if (v === null || isString(v) || isNumber(v) || isBoolean(v)) {
    return v;
  }
  if (Array.isArray(v)) {
    const arr = [];
    for (const item of v) {
      const mapped = toJsonValue(item);
      if (mapped !== undefined) arr.push(mapped);
    }
    return arr;
  }
  if (isRecord(v)) {
    const rec = {};
    for (const [k, vv] of Object.entries(v)) {
      const mapped = toJsonValue(vv);
      if (mapped !== undefined) rec[k] = mapped;
    }
    return rec;
  }
  return undefined;
}

function mapProviderSpecificData(data) {
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    out[k] = toJsonValue(v);
  }
  return out;
}

function mapRuntimeTransport(rt) {
  const out = {};
  let hasData = false;

  if (isString(rt.baseUrl)) {out.baseUrl = rt.baseUrl;hasData = true;}
  if (isString(rt.urlSuffix)) {out.urlSuffix = rt.urlSuffix;hasData = true;}

  if (isRecord(rt.headers)) {
    const headers = Object.fromEntries(
      Object.entries(rt.headers).filter(([, v]) => isString(v))
    );
    if (Object.keys(headers).length > 0) {out.headers = headers;hasData = true;}
  }

  if (isRecord(rt.auth)) {
    const auth = rt.auth;
    const mappedAuth = {
      combined: auth.combined === true,
      anthropicVersion: auth.anthropicVersion === true
    };
    if (isString(auth.header)) mappedAuth.header = auth.header;
    if (isString(auth.scheme)) mappedAuth.scheme = auth.scheme;
    if (isRecord(auth.apiKey)) {
      mappedAuth.apiKey = {
        header: isString(auth.apiKey.header) ? auth.apiKey.header : "",
        scheme: isString(auth.apiKey.scheme) ? auth.apiKey.scheme : ""
      };
    }
    if (isRecord(auth.oauth)) {
      mappedAuth.oauth = {
        header: isString(auth.oauth.header) ? auth.oauth.header : "",
        scheme: isString(auth.oauth.scheme) ? auth.oauth.scheme : ""
      };
    }
    if (Array.isArray(auth.hooks)) {
      const hooks = auth.hooks.filter((h) => isString(h));
      if (hooks.length > 0) mappedAuth.hooks = hooks;
    }
    out.auth = mappedAuth;
    hasData = true;
  }

  if (isString(rt.format)) {out.format = rt.format;hasData = true;}
  return hasData ? out : undefined;
}

/**
 * Convert a loose credential record (e.g. from getProviderCredentials) into the
 * ExecutorCredentials shape expected by open-sse core handlers. Unknown fields
 * are dropped; providerSpecificData is recursively mapped to JsonValue.
 *
 * @param {object} creds
 * @returns {object}
 */
export function toExecutorCredentials(creds) {
  const out = {};

  if (isString(creds.apiKey)) out.apiKey = creds.apiKey;
  if (isString(creds.accessToken)) out.accessToken = creds.accessToken;
  if (isString(creds.refreshToken)) out.refreshToken = creds.refreshToken;
  if (isString(creds.copilotToken)) out.copilotToken = creds.copilotToken;
  if (isString(creds.expiresAt) || isNumber(creds.expiresAt)) out.expiresAt = creds.expiresAt;
  if (isString(creds.connectionName)) out.connectionName = creds.connectionName;
  if (isString(creds.connectionId)) out.connectionId = creds.connectionId;

  const rawHeaders = isRecord(creds.rawHeaders) ?
  Object.fromEntries(
    Object.entries(creds.rawHeaders).filter(([, v]) => isString(v))
  ) :
  undefined;
  if (rawHeaders && Object.keys(rawHeaders).length > 0) out.rawHeaders = rawHeaders;

  if (isRecord(creds.providerSpecificData)) {
    out.providerSpecificData = mapProviderSpecificData(creds.providerSpecificData);
  }

  if (isRecord(creds.runtimeTransport)) {
    const mapped = mapRuntimeTransport(creds.runtimeTransport);
    if (mapped) out.runtimeTransport = mapped;
  }

  return out;
}

/**
 * Map a typed ExecutorResult into the normalized CoreResult shape used by SSE
 * handlers. Core handlers now return ExecutorResult directly, so this is a
 * narrow discriminator-driven mapping rather than a validation pass.
 *
 * @param {object} result
 * @param {string} fallbackError
 * @returns {object}
 */
export function toCoreResult(result, fallbackError) {
  if (result.success) {
    return {
      success: true,
      response: result.response,
      status: result.status,
      error: fallbackError,
      resetsAtMs: null
    };
  }
  return {
    success: false,
    response: result.response,
    status: result.status,
    error: result.error,
    resetsAtMs: result.resetsAtMs ?? null
  };
}