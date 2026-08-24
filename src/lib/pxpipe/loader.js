import { pathToFileURL } from "node:url";
import { getInstallInfo, libraryEntry } from "./install.js";

// Module cache: pxpipe is loaded once per process ("started") and dropped on
// "stop". In library mode start/stop govern the in-process module, not a daemon.
import { isBoolean, isFunction } from "../../shared/utils/typeChecks.js";

let cached = null; // { module, version, loadedAt }
let loadPromise = null;

function normalizeLibraryResult(result) {
  if (!result) return null;
  const applied = isBoolean(result.applied) ?
  result.applied :
  result.info?.compressed === true;
  return {
    ...result,
    applied,
    reason: result.reason || result.info?.reason || (applied ? "applied" : "passthrough")
  };
}

/**
 * Select the pxpipe library entry point for the request wire format. The
 * Anthropic and OpenAI APIs use incompatible image block shapes, so they must
 * never share transformAnthropicMessages.
 */
export function createPxpipeDispatcher(mod) {
  return async (args = {}) => {
    const format = args.format || "claude";
    const isResponses = format === "openai-responses" || format === "openai-response";
    const transform = format === "openai" ?
    mod.transformOpenAIChatCompletions :
    isResponses ?
    mod.transformOpenAIResponses :
    format === "claude" ?
    mod.transformAnthropicMessages :
    null;
    if (!isFunction(transform)) {
      return {
        applied: false,
        body: args.body,
        reason: "unsupported_format",
        detail: `pxpipe does not provide a ${format} transformer`
      };
    }
    const result = format === "claude" ?
    await transform(args) :
    await transform(args.body, { compress: true, ...(args.options || {}) });
    return normalizeLibraryResult(result);
  };
}

export function getLoadedInfo() {
  return cached ? { loaded: true, version: cached.version, loadedAt: cached.loadedAt } : { loaded: false };
}

export async function loadPxpipe() {
  if (cached) return cached;
  if (loadPromise) return loadPromise;
  loadPromise = doLoad().finally(() => {loadPromise = null;});
  return loadPromise;
}

async function doLoad() {
  const info = getInstallInfo();
  if (!info.installed) {
    const err = new Error(info.reason || "PXPIPE is not installed");
    err.code = "NOT_INSTALLED";
    err.surface = info.reason || "NOT_INSTALLED";
    throw err;
  }
  // Cache-bust per version so upgrades take effect without a server restart.
  const entry = libraryEntry();
  const url = `${pathToFileURL(entry).href}?v=${encodeURIComponent(info.version || "0")}`;
  const mod = await import(/* webpackIgnore: true */url);
  if (!isFunction(mod.transformAnthropicMessages)) {
    throw new Error("pxpipe package does not export transformAnthropicMessages");
  }
  cached = { module: mod, version: info.version, loadedAt: Date.now() };
  return cached;
}

export function unloadPxpipe() {
  const wasLoaded = !!cached;
  cached = null;
  return wasLoaded;
}

// Transform function for the request pipeline; null when unavailable (fail-open).
// autoLoad controls whether a cold cache triggers a load (first request warms it).
export async function getTransform({ autoLoad = true } = {}) {
  try {
    if (!cached && !autoLoad) return null;
    const { module: mod } = await loadPxpipe();
    return createPxpipeDispatcher(mod);
  } catch {
    return null;
  }
}

// Health self-test: run a tiny synthetic Claude request through the transformer.
// A healthy module parses it and answers with a machine-readable reason.
export async function selfTest() {
  const startedAt = Date.now();
  const { module: mod } = await loadPxpipe();
  const body = new TextEncoder().encode(JSON.stringify({
    model: "claude-fable-5",
    max_tokens: 16,
    messages: [{ role: "user", content: "ping" }]
  }));
  const result = await mod.transformAnthropicMessages({ body, model: "claude-fable-5" });
  if (!result || !isBoolean(result.applied) || !(result.body instanceof Uint8Array)) {
    throw new Error("transform returned an unexpected shape");
  }
  return { ok: true, reason: result.reason, durationMs: Date.now() - startedAt };
}