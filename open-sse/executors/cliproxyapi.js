import { BaseExecutor } from "./base.js";
import { FETCH_CONNECT_TIMEOUT_MS } from "../config/runtimeConfig.js";
import { getProviderPluginManifestHeader } from "../config/providerPluginManifestUrl.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = "8317";
const URL_CACHE_TTL_MS = 60_000;
let cachedUrl = null;

export function clearCliproxyapiUrlCache() {
  cachedUrl = null;
}

async function resolveCliproxyapiBaseUrl() {
  if (cachedUrl && Date.now() - cachedUrl.ts < URL_CACHE_TTL_MS) return cachedUrl.url;

  try {
    const { getSettings } = await import("@/lib/localDb");
    const settings = await getSettings();
    if (typeof settings?.cliproxyapi_url === "string" && settings.cliproxyapi_url.trim()) {
      cachedUrl = { url: settings.cliproxyapi_url.trim().replace(/\/+$/, ""), ts: Date.now() };
      return cachedUrl.url;
    }
  } catch {
    // Environment/default fallback below.
  }

  const host = process.env.CLIPROXYAPI_HOST || DEFAULT_HOST;
  const port = process.env.CLIPROXYAPI_PORT || DEFAULT_PORT;
  cachedUrl = { url: `http://${host}:${port}`, ts: Date.now() };
  return cachedUrl.url;
}

function resolveCliproxyapiBaseUrlSync() {
  if (cachedUrl && Date.now() - cachedUrl.ts < URL_CACHE_TTL_MS) return cachedUrl.url;
  const host = process.env.CLIPROXYAPI_HOST || DEFAULT_HOST;
  const port = process.env.CLIPROXYAPI_PORT || DEFAULT_PORT;
  return `http://${host}:${port}`;
}

export { resolveCliproxyapiBaseUrl };

export function isCliproxyapiDeepModeEnabled(providerSpecificData) {
  return providerSpecificData?.cliproxyapiMode === "claude-native";
}

/**
 * CLIProxyAPI passthrough executor.
 *
 * It preserves chatCore's translated body and delegates dispatch to a local
 * CLIProxyAPI-compatible sidecar. The manifest header lets the sidecar discover
 * DurinDoor provider metadata without importing this JS runtime.
 */
export class CliproxyapiExecutor extends BaseExecutor {
  constructor(baseUrl = resolveCliproxyapiBaseUrlSync()) {
    super("cliproxyapi", {
      baseUrl: `${baseUrl}/v1/chat/completions`,
      headers: { "Content-Type": "application/json" },
      noAuth: true,
    });
    this.noAuth = true;
  }

  buildUrl() {
    return `${resolveCliproxyapiBaseUrlSync()}/v1/chat/completions`;
  }

  buildHeaders(credentials, stream = true) {
    const headers = {
      "Content-Type": "application/json",
      ...getProviderPluginManifestHeader(),
    };
    const key = credentials?.apiKey || credentials?.accessToken;
    if (key) headers.Authorization = `Bearer ${key}`;
    if (stream) headers.Accept = "text/event-stream";
    return headers;
  }

  async execute({ model, body, stream, credentials, signal, log }) {
    const baseUrl = await resolveCliproxyapiBaseUrl();
    const url = `${baseUrl}/v1/chat/completions`;
    const transformedBody =
      body && typeof body === "object" ? { ...body, model: body.model || model } : body;
    const headers = this.buildHeaders(credentials, stream);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error("cliproxyapi fetch timeout")), FETCH_CONNECT_TIMEOUT_MS);
    const mergedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;

    try {
      log?.debug?.("CLIPROXYAPI", `dispatch ${model} -> ${url}`);
      const response = await proxyAwareFetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(transformedBody),
        signal: mergedSignal,
      });
      return { response, url, headers, transformedBody };
    } finally {
      clearTimeout(timeout);
    }
  }
}
