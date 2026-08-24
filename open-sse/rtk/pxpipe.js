// PXPIPE: render bulky Claude-format context as dense PNGs via pxpipe-proxy's
// library API (transformAnthropicMessages). Fail-open like every token saver:
// any error/timeout returns { body: null, summary } and leaves the request untouched.
import { FORMATS } from "../translator/formats.js";
import { isFunction, isNumber } from "@/shared/utils/typeChecks.js";

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

// New-contract gates return null so callers can distinguish an early no-op.
// The request pipeline uses this normalizer before logging/persisting stats so
// a skip can never turn into a null dereference on the request path.
export function normalizePxpipeResult(result, diagnostics = {}) {
  return result || skipped(diagnostics.reason || "skipped");
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
  if ([FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI_RESPONSE].includes(format)) {
    return /^blackboxai\/anthropic\/claude-fable/.test(m);
  }
  return false;
}

function hasExplicitAllowedModels(allowedModels) {
  return Array.isArray(allowedModels) && allowedModels.length > 0;
}

// Effective model predicate: when the user has configured an explicit allow-list,
// that list replaces the hard-coded gate. When unset (empty), keep the legacy
// safe-default whitelist so existing deployments keep current behavior.
function isPxpipeAllowedModel(format, model, allowedModels) {
  if (!model) return false;
  if (hasExplicitAllowedModels(allowedModels)) {
    return allowedModels.some((m) => String(m) === String(model));
  }
  return isSupportedModel(format, model);
}

function isOpenAiFormat(format) {
  return [FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI_RESPONSE].includes(format);
}

// Transform a Claude-format request body through pxpipe. Returns
// { body: <new body object> | null, summary, applied, reason, info?, originalChars?, durationMs? }.
// Returns `null` for early no-op cases (disabled or unsupported model) so
// callers can short-circuit without inspecting the summary shape.
// opts.transform is injected by the host (src side) so open-sse stays free of
// filesystem/install concerns and remains usable standalone.
export async function compressWithPxpipe(body, { enabled, format, model, minChars, timeoutMs, transform, diagnostics, allowedModels } = {}) {
  // Back-compat discriminator: newer callers (pxpipe-stage) pass format+model
  // and expect `null` + `diagnostics.reason` for early no-op cases. Legacy
  // callers pass neither and read the nested summary.reason shape.
  const isNewContract = !!(format && model);

  if (enabled === false) {
    if (isNewContract) return null;
    return skipped("disabled");
  }

  // Model gate (only on the new contract): null + diagnostics when the model
  // is not allowed. An explicit allow-list replaces the hard-coded whitelist;
  // when unset the legacy safe-default gate is preserved.
  if (isNewContract && body && !isPxpipeAllowedModel(format, model, allowedModels)) {
    if (diagnostics) {
      diagnostics.reason = hasExplicitAllowedModels(allowedModels) ? "not_allowed" : "unsupported_model";
    }
    return null;
  }

  // Only Claude-format bodies and OpenAI-shaped Blackbox Anthropic aliases are
  // supported wire formats. The allow-list governs *which* model may enter; the
  // format still determines how the body is rewritten for the transformer.
  const openAiAllowed = isOpenAiFormat(format) && isNewContract && isPxpipeAllowedModel(format, model, allowedModels);
  if (format !== FORMATS.CLAUDE && !openAiAllowed) {
    return skipped("unsupported_format", { detail: format });
  }

  // Blackbox's Anthropic/Fable alias is transported through an OpenAI-shaped
  // request even though pxpipe's transformer is model-specific. Strip the
  // Blackbox routing prefix before passing to the transformer; all other models
  // flow through with their original id.
  const isOpenAiFable = isOpenAiFormat(format) && /^blackboxai\/anthropic\//.test(String(model));

  if (!body) {
    const r = skipped("missing_body");
    if (diagnostics) diagnostics.reason = r.reason;
    return r;
  }
  if (!isFunction(transform)) {
    // pxpipe-stage contract: when allowed model but no transform, prefer
    // not_profitable so the caller treats it as a profitability skip.
    // Legacy callers still get not_installed.
    const reason = isNewContract && isPxpipeAllowedModel(format, model, allowedModels) ? "not_profitable" : "not_installed";
    const r = skipped(reason, reason === "not_profitable" ? { detail: "not_installed" } : undefined);
    if (diagnostics) diagnostics.reason = r.reason;
    return r;
  }

  const startedAt = Date.now();
  const originalChars = bodyChars(body);
  const threshold = Number(minChars) > 0 ? Number(minChars) : DEFAULT_MIN_CHARS;
  if (originalChars < threshold) {
    return skipped("below_threshold", { originalChars, threshold });
  }

  let timeoutId = null;
  try {
    const transformBody = isOpenAiFable ?
    { ...body, model: String(model).slice("blackboxai/anthropic/".length) } :
    body;
    const encoded = new TextEncoder().encode(JSON.stringify(transformBody));
    const budget = Number(timeoutMs) > 0 ? Number(timeoutMs) : DEFAULT_TIMEOUT_MS;
    // timer and discard the result if it loses (input body is never mutated).
    const result = await Promise.race([
    transform({
      body: encoded,
      model,
      format,
      options: { minCompressChars: threshold }
    }),
    new Promise((resolve) => {
      timeoutId = setTimeout(() => resolve(null), budget);
      timeoutId.unref?.();
    })]
    );
    if (!result) return skipped("timeout", { originalChars, durationMs: Date.now() - startedAt });
    if (!result.applied) {
      return skipped(result.reason || "passthrough", {
        detail: result.detail,
        originalChars,
        durationMs: Date.now() - startedAt
      });
    }

    const newBody = JSON.parse(new TextDecoder().decode(result.body));
    if (isOpenAiFable) newBody.model = body.model;
    const compressedBodyChars = bodyChars(newBody);
    const info = result.info || {};
    const imagedChars = info.compressedChars || 0;
    // The transformed body is BIGGER in bytes (base64 PNGs) but cheaper in tokens:
    // images bill by pixels (Anthropic: pixels/750), not by encoded length. So the
    // after-estimate is remaining-text tokens + image tokens — never chars/4 of the
    // new body. Provider-billed usage recorded per request stays the ground truth.
    const imageTokensEst = info.imageTokens || (
    info.imagePixels ? Math.round(info.imagePixels / 750) : (info.imageCount || 0) * 4761);
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
      cacheOwnsControl: result.cache?.ownsCacheControl === true
    };
    summary.tokensSavedEst = Math.max(0, summary.tokensBeforeEst - summary.tokensAfterEst);
    summary.savedPct = summary.tokensBeforeEst > 0 ?
    +(summary.tokensSavedEst / summary.tokensBeforeEst * 100).toFixed(2) :
    0;
    // Return shape: { body, summary, applied, reason, info, originalChars, durationMs }
    // so tests can read res.applied, res.reason, res.info directly.
    const flat = {
      applied: true,
      reason: "applied",
      body: newBody,
      info: {
        origChars: originalChars,
        compressedChars: compressedBodyChars,
        imageCount: summary.imageCount
      },
      originalChars,
      durationMs: summary.durationMs
    };
    return { ...flat, summary };
  } catch (e) {
    return skipped("transform_error", { detail: e?.message || String(e), originalChars, durationMs: Date.now() - startedAt });
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export function formatPxpipeLog(summary) {
  if (!summary) return null;
  const info = summary.info;
  if (info && isNumber(info.origChars) && isNumber(info.compressedChars)) {
    return `${info.origChars}→${info.compressedChars} chars, ${isNumber(info.imageCount) ? info.imageCount : 0} image(s)`;
  }
  if (summary.applied && isNumber(summary.compressedBodyChars)) {
    return `${summary.originalChars}→${summary.compressedBodyChars} chars, ${summary.imageCount || 0} image(s)`;
  }
  return null;
}