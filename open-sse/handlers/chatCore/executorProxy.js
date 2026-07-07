import { getSettings } from "@/lib/localDb";
import { getExecutor } from "../../executors/index.js";
import { isCliproxyapiDeepModeEnabled } from "../../executors/cliproxyapi.js";
import { getUpstreamProxyConfigCached } from "./comboContextCache.js";

const CLIPROXYAPI_PROVIDER_ID = "cliproxyapi";
const DEFAULT_FALLBACK_CODES = [429, 500, 502, 503, 504];

function parseFallbackCodes(value) {
  if (typeof value !== "string" || !value.trim()) return DEFAULT_FALLBACK_CODES;
  const parsed = value
    .split(",")
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((code) => Number.isInteger(code));
  return parsed.length ? parsed : DEFAULT_FALLBACK_CODES;
}

async function resolveCliproxyapiModel(providerId, model, providerMapping) {
  if (providerMapping?.[model]) return providerMapping[model];
  if (providerId === CLIPROXYAPI_PROVIDER_ID) return model;

  const sentinelCfg = await getUpstreamProxyConfigCached(CLIPROXYAPI_PROVIDER_ID);
  return sentinelCfg.cliproxyapiModelMapping?.[model] || model;
}

async function mapCliproxyapiInput(providerId, input, providerMapping) {
  const mappedModel = await resolveCliproxyapiModel(providerId, input.model, providerMapping);
  if (mappedModel === input.model) return input;

  const mappedBody =
    input.body && typeof input.body === "object"
      ? { ...input.body, model: mappedModel }
      : input.body;

  return { ...input, model: mappedModel, body: mappedBody };
}

async function executeCliproxyapiMapped(proxyExec, providerId, input, providerMapping) {
  return proxyExec.execute(await mapCliproxyapiInput(providerId, input, providerMapping));
}

async function getFallbackCodes() {
  try {
    const settings = await getSettings();
    return parseFallbackCodes(settings?.cliproxyapi_fallback_codes);
  } catch {
    return DEFAULT_FALLBACK_CODES;
  }
}

/**
 * Resolve the executor for a request, honoring provider-level and
 * per-connection CLIProxyAPI routing overrides.
 */
export async function resolveExecutorWithProxy(providerId, log, providerSpecificData = null) {
  if (isCliproxyapiDeepModeEnabled(providerSpecificData)) {
    log?.info?.(
      "UPSTREAM_PROXY",
      `${providerId} routed through CLIProxyAPI (per-connection claude-native override)`
    );
    const proxyExec = getExecutor(CLIPROXYAPI_PROVIDER_ID);
    const nativeExec = getExecutor(providerId);
    const wrapper = Object.create(proxyExec);
    wrapper.noAuth = nativeExec.noAuth === true;
    wrapper.execute = (input) =>
      executeCliproxyapiMapped(proxyExec, providerId, input, providerSpecificData?.cliproxyapiModelMapping);
    if (typeof nativeExec.refreshCredentials === "function") {
      wrapper.refreshCredentials = nativeExec.refreshCredentials.bind(nativeExec);
    }
    return wrapper;
  }

  const cfg = await getUpstreamProxyConfigCached(providerId);
  if (!cfg.enabled || cfg.mode === "native") return getExecutor(providerId);

  const proxyExec = getExecutor(CLIPROXYAPI_PROVIDER_ID);
  if (cfg.mode === "cliproxyapi") {
    log?.info?.("UPSTREAM_PROXY", `${providerId} routed through CLIProxyAPI (passthrough)`);
    const nativeExec = getExecutor(providerId);
    const wrapper = Object.create(proxyExec);
    wrapper.noAuth = nativeExec.noAuth === true;
    wrapper.execute = (input) =>
      executeCliproxyapiMapped(proxyExec, providerId, input, cfg.cliproxyapiModelMapping);
    if (typeof nativeExec.refreshCredentials === "function") {
      wrapper.refreshCredentials = nativeExec.refreshCredentials.bind(nativeExec);
    }
    return wrapper;
  }

  const nativeExec = getExecutor(providerId);
  const fallbackCodes = await getFallbackCodes();
  const isRetryableStatus = (status) => fallbackCodes.includes(status) || status === 0;
  const wrapper = Object.create(nativeExec);
  wrapper.noAuth = nativeExec.noAuth === true;
  wrapper.execute = async (input) => {
    let result;
    try {
      result = await nativeExec.execute(input);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log?.info?.("UPSTREAM_PROXY", `${providerId} native error (${message}), retrying via CLIProxyAPI`);
      return executeCliproxyapiMapped(proxyExec, providerId, input, cfg.cliproxyapiModelMapping);
    }

    if (!isRetryableStatus(result.response.status)) return result;
    log?.info?.(
      "UPSTREAM_PROXY",
      `${providerId} native failed (${result.response.status}), retrying via CLIProxyAPI`
    );
    return executeCliproxyapiMapped(proxyExec, providerId, input, cfg.cliproxyapiModelMapping);
  };

  return wrapper;
}
