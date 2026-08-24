// open-sse/services/compression/engines/headroomAdapter.js
//
// Bridge the compression-engine contract onto the existing RTK headroom proxy
// (open-sse/rtk/headroom.js#compressWithHeadroom). We do NOT port omniroute's
// headroom engine — ours already supports openai / openai-responses / claude /
// kiro shapes and the fail-open diagnostics seam.
//
// compressWithHeadroom MUTATES the body it is given. To honor the engine
// contract (caller owns the original body; fail-open returns it untouched) we
// compress a structured-cloned copy and return the copy as `body`.
//
// The headroom module's static graph reaches the app translator layer
// (`open-sse` package alias), which only resolves under the app/vitest runtime.
// We therefore resolve it LAZILY inside apply() so this adapter (and the
// compression registry) stay synchronous and alias-free at module load.

import { createCompressionStats } from "../stats.js";
import { isBoolean, isFunction, isNumber, isObject, isString } from "@/shared/utils/typeChecks.js";

const ENGINE_ID = "headroom";

function cloneBody(body) {
  if (body === null || !isObject(body)) return { ok: true, value: body };
  if (isFunction(structuredClone)) {
    try {
      return { ok: true, value: structuredClone(body) };
    } catch {

      /* fall through to JSON clone */}
  }
  try {
    return { ok: true, value: JSON.parse(JSON.stringify(body)) };
  } catch {
    return { ok: false };
  }
}

export const headroomEngine = {
  id: ENGINE_ID,
  name: "Headroom",
  description: "RTK headroom proxy: translate -> compress service -> translate back.",
  icon: "compress",
  targets: ["messages"],
  stackable: true,
  stackPriority: 15,
  metadata: {
    id: ENGINE_ID,
    name: "Headroom",
    description: "RTK headroom proxy compression.",
    inputScope: "messages",
    targetLatencyMs: 50,
    supportsPreview: false,
    stable: true
  },
  async apply(body, options) {
    const cfg = options?.config ?? {};
    const step = options?.stepConfig ?? {};
    const enabled = step.enabled ?? cfg.enabled ?? cfg.headroom?.enabled ?? false;
    const url = step.url ?? cfg.url ?? cfg.headroom?.url ?? null;
    const model = step.model ?? cfg.model ?? body?.model ?? null;
    const format = step.format ?? cfg.format ?? "openai";
    const compressUserMessages = step.compressUserMessages ?? cfg.compressUserMessages;
    const timeoutMs = step.timeoutMs ?? cfg.timeoutMs;

    // Disabled / unconfigured: deterministic no-op. Never touch the (heavy,
    // alias-bound) translator graph for an engine that isn't going to run.
    if (!enabled || !url) return { body, compressed: false, stats: null };

    const cloned = cloneBody(body);
    if (!cloned.ok) {
      // Could not clone: never hand the caller's body to the in-place-mutating proxy.
      return { body, compressed: false, stats: null };
    }
    const working = cloned.value;

    // Resolve the proxy OUTSIDE the compression try: a module-resolution
    // failure here is an environment error (alias not configured) and must
    // propagate, not be masked as a benign "no compression" result.
    const { compressWithHeadroom } = await import("../../../rtk/headroom.js");

    const diagnostics = {};
    let data;
    try {
      data = await compressWithHeadroom(working, {
        enabled,
        url,
        model,
        format,
        compressUserMessages,
        timeoutMs,
        diagnostics
      });
    } catch {
      // Genuine compression/runtime failure -> fail-open: keep original body.
      return { body, compressed: false, stats: null };
    }
    if (!data) return { body, compressed: false, stats: null };

    const stats = createCompressionStats(body, working, ENGINE_ID, [ENGINE_ID]);
    const tokensSaved =
    isNumber(data.tokens_saved) ?
    data.tokens_saved :
    isNumber(data.tokensSaved) ?
    data.tokensSaved :
    null;
    const saved =
    tokensSaved !== null ? tokensSaved > 0 : (stats?.savingsPercent ?? 0) > 0;
    if (!saved) return { body, compressed: false, stats: null };
    return { body: working, compressed: true, stats };
  },
  async compress(body, config) {
    return this.apply(body, { stepConfig: config });
  },
  getConfigSchema() {
    return [
    { key: "enabled", type: "boolean", label: "Enabled", defaultValue: false },
    { key: "url", type: "string", label: "Proxy URL", defaultValue: "" }];

  },
  validateConfig(config) {
    const errors = [];
    if (config.enabled !== undefined && !isBoolean(config.enabled)) {
      errors.push("enabled must be a boolean");
    }
    if (config.url !== undefined && !isString(config.url)) {
      errors.push("url must be a string");
    }
    return { valid: errors.length === 0, errors };
  }
};