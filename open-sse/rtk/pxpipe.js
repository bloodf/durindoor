// PXPIPE: render bulky Claude-format context as dense PNGs via pxpipe-proxy's
// library API (transformAnthropicMessages). Fail-open like every token saver:
// any error/timeout returns { body: null, summary } and leaves the request untouched.
import { FORMATS } from "../translator/formats.js";

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MIN_CHARS = 25000;
// pxpipe's own profitability gate assumes ~4 chars/token; reuse it for the
// estimated before/after numbers surfaced in stats (marked "estimated" in UI).
const EST_CHARS_PER_TOKEN = 4;

function bodyChars(body) {
  try {
    return JSON.stringify(body)?.length || 0;
  } catch {
    return 0;
  }
}

function estTokens(chars) {
  return Math.round(chars / EST_CHARS_PER_TOKEN);
}

function skipped(reason, extra = {}) {
  return { body: null, summary: { applied: false, reason, ...extra }, applied: false, reason };
}

function isSupportedModel(format, model) {
  if (!model) return false;
  const m = String(model).toLowerCase();
  // Tight model whitelist: only claude-fable for Claude format, and only
  // blackbox Anthropic aliases (e.g. Fable) for OpenAI format. Other model
  // ids (claude-haiku, claude-sonnet, ...) return unsupported_model so the
  // caller can record the skip reason without burning pxpipe credits.
  if (format === FORMATS.CLAUDE) {
    return /claude-fable/.test(m);
  }
  if (format === FORMATS.OPENAI) {
    return /blackboxai\/.+anthropic\/claude-fable/.test(m);
  }
  return false;
}

// Transform a Claude-format request body through pxpipe. Returns
// { body: <new body object> | null, summary, applied, reason, info?, originalChars?, durationMs? }.
// Returns `null` for early no-op cases (disabled or unsupported model) so
// callers can short-circuit without inspecting the summary shape.
// opts.transform is injected by the host (src side) so open-sse stays free of
// filesystem/install concerns and remains usable standalone.
export async function compressWithPxpipe(body, { enabled, format, model, minChars, timeoutMs, transform, diagnostics } = {}) {
  if (enabled === false) return null;
  if (body && !isSupportedModel(format, model)) {
    if (diagnostics) diagnostics.reason = "unsupported_model";
    return null;
  }
  if (!body) {
    const r = skipped("missing_body");
    if (diagnostics) diagnostics.reason = r.reason;
    return r;
  }
  if (typeof transform !== "function") {
    const r = skipped("not_profitable", { detail: "not_installed" });
    if (diagnostics) diagnostics.reason = r.reason;
    return r;
  }

  const startedAt = Date.now();
  const originalChars = bodyChars(body);
  const threshold = Number(minChars) > 0 ? Number(minChars) : DEFAULT_MIN_CHARS;
  if (originalChars < threshold) {
    return skipped("below_threshold", { originalChars, threshold });
  }

  try {
    const encoded = new TextEncoder().encode(JSON.stringify(body));
    const budget = Number(timeoutMs) > 0 ? Number(timeoutMs) : DEFAULT_TIMEOUT_MS;
    // transformAnthropicMessages is local CPU work and can't be aborted; race a
    // timer and discard the result if it loses (input body is never mutated).
    const result = await Promise.race([
      transform({
        body: encoded,
        model,
        options: { minCompressChars: threshold },
      }),
      new Promise((resolve) => setTimeout(() => resolve(null), budget)),
    ]);
    if (!result) return skipped("timeout", { originalChars, durationMs: Date.now() - startedAt });
    if (!result.applied) {
      return skipped(result.reason || "passthrough", {
        detail: result.detail,
        originalChars,
        durationMs: Date.now() - startedAt,
      });
    }

    const newBody = JSON.parse(new TextDecoder().decode(result.body));
    const compressedBodyChars = bodyChars(newBody);
    const info = result.info || {};
    const imagedChars = info.compressedChars || 0;
    // The transformed body is BIGGER in bytes (base64 PNGs) but cheaper in tokens:
    // images bill by pixels (Anthropic: pixels/750), not by encoded length. So the
    // after-estimate is remaining-text tokens + image tokens — never chars/4 of the
    // new body. Provider-billed usage recorded per request stays the ground truth.
    const imageTokensEst = info.imageTokens
      || (info.imagePixels ? Math.round(info.imagePixels / 750) : (info.imageCount || 0) * 4761);
    const summary = {
      applied: true,
      reason: "applied",
      originalChars,
      compressedBodyChars,
      imagedChars,
      imageCount: info.imageCount || 0,
      imageBytes: info.imageBytes || 0,
      tokensBeforeEst: info.baselineTokens || estTokens(originalChars),
      tokensAfterEst: estTokens(Math.max(0, originalChars - imagedChars)) + imageTokensEst,
      durationMs: Date.now() - startedAt,
      cacheOwnsControl: result.cache?.ownsCacheControl === true,
    };
    summary.tokensSavedEst = Math.max(0, summary.tokensBeforeEst - summary.tokensAfterEst);
    summary.savedPct = summary.tokensBeforeEst > 0
      ? +((summary.tokensSavedEst / summary.tokensBeforeEst) * 100).toFixed(2)
      : 0;
    // Return shape: { body, summary, applied, reason, info, originalChars, durationMs }
    // so tests can read res.applied, res.reason, res.info directly.
    const flat = {
      applied: true,
      reason: "applied",
      body: newBody,
      info: {
        origChars: originalChars,
        compressedChars: compressedBodyChars,
        imageCount: summary.imageCount,
      },
      originalChars,
      durationMs: summary.durationMs,
    };
    return { ...flat, summary };
  } catch (e) {
    return skipped("transform_error", { detail: e?.message || String(e), originalChars, durationMs: Date.now() - startedAt });
  }
}

export function formatPxpipeLog(summary) {
  if (!summary) return null;
  const info = summary.info;
  if (info && typeof info.origChars === "number" && typeof info.compressedChars === "number") {
    return `${info.origChars}→${info.compressedChars} chars, ${typeof info.imageCount === "number" ? info.imageCount : 0} image(s)`;
  }
  if (summary.applied && typeof summary.compressedBodyChars === "number") {
    return `${summary.originalChars}→${summary.compressedBodyChars} chars, ${summary.imageCount || 0} image(s)`;
  }
  return null;
}
