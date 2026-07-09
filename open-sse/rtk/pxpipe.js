// PXPIPE: render bulky context as dense PNGs via pxpipe-proxy's library API
// (transformAnthropicMessages). Fail-open like every token saver: any
// error/timeout returns { body: null, summary } and leaves the request untouched.
//
// Null contract (new callers that pass both format+model):
//   - disabled / unsupported_model → return `null` (optionally set diagnostics.reason)
//   - all other skips/applies → return the object shape below
// Legacy callers (no format+model pair) always get the object shape.
//
// OpenAI Blackbox Fable aliases are supported: the transform still speaks
// Anthropic Messages, so we openai→claude normalize, transform, then
// claude→openai round-trip before returning the body to the OpenAI transport.
import { FORMATS } from "../translator/formats.js";
import { openaiToClaudeRequest } from "../translator/request/openai-to-claude.js";
import { claudeToOpenAIRequest } from "../translator/request/claude-to-openai.js";

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

/** True for models pxpipe is allowed to image for the given wire format. */
function isSupportedModel(format, model) {
  if (!model) return false;
  const m = String(model).toLowerCase();
  // Tight model whitelist: only claude-fable for Claude format, and only
  // blackbox Anthropic Fable aliases for OpenAI format. Other model ids
  // (claude-haiku, claude-sonnet, blackboxai/openai/gpt-...) return
  // unsupported_model so the caller can record the skip without burning credits.
  if (format === FORMATS.CLAUDE) {
    return /claude-fable/.test(m);
  }
  if (format === FORMATS.OPENAI) {
    // blackboxai/anthropic/claude-fable-5  (no extra segment)
    // blackboxai/<vendor>/anthropic/claude-fable-5  (optional mid segment)
    return /blackboxai\/(?:.+\/)?anthropic\/claude-fable/.test(m);
  }
  return false;
}

/**
 * Normalize an OpenAI-format Blackbox Fable body into Anthropic Messages shape
 * for transformAnthropicMessages, then map the transformed Claude body back.
 * @returns {{ transformBody: object, restore: (claudeBody: object) => object } | null}
 */
function prepareTransformBody(body, format, model) {
  if (format === FORMATS.CLAUDE) {
    return { transformBody: body, restore: (next) => next };
  }
  if (format === FORMATS.OPENAI && isSupportedModel(format, model)) {
    const claudeBody = openaiToClaudeRequest(model, body, body?.stream === true);
    if (!claudeBody || !Array.isArray(claudeBody.messages)) return null;
    // Keep original model id on the Claude-shaped body so the transform gate
    // sees the upstream alias (pxpipe accepts Fable aliases).
    claudeBody.model = model;
    return {
      transformBody: claudeBody,
      restore: (nextClaude) => {
        const openaiBody = claudeToOpenAIRequest(model, nextClaude, body?.stream === true);
        // Preserve non-message OpenAI fields the Anthropic hop drops.
        return {
          ...body,
          ...openaiBody,
          model,
        };
      },
    };
  }
  return null;
}

/**
 * Transform a request body through pxpipe.
 *
 * Return shapes:
 * - New contract (format+model both set): `null` for disabled/unsupported_model;
 *   otherwise `{ body, summary, applied, reason, info?, originalChars?, durationMs? }`.
 * - Legacy contract: always the object shape (never null).
 *
 * opts.transform is injected by the host (src side) so open-sse stays free of
 * filesystem/install concerns and remains usable standalone.
 */
export async function compressWithPxpipe(body, { enabled, format, model, minChars, timeoutMs, transform, diagnostics } = {}) {
  // Back-compat discriminator: newer callers (pxpipe-stage) pass format+model
  // and expect `null` + `diagnostics.reason` for early no-op cases. Legacy
  // callers pass neither and read the nested summary.reason shape.
  const isNewContract = !!(format && model);

  if (enabled === false) {
    if (isNewContract) return null;
    return skipped("disabled");
  }

  // Model gate (only on the new contract): null + diagnostics for known
  // unsupported model ids. Triggered for Claude-format non-fable ids and
  // OpenAI-format blackbox aliases whose path is not Anthropic/Fable.
  if (isNewContract && body && !isSupportedModel(format, model)) {
    const openaiBlackboxNonAnthropic = format === FORMATS.OPENAI
      && /^blackboxai\//.test(String(model))
      && !isSupportedModel(format, model);
    const claudeUnsupported = format === FORMATS.CLAUDE && !isSupportedModel(format, model);
    if (openaiBlackboxNonAnthropic || claudeUnsupported) {
      if (diagnostics) diagnostics.reason = "unsupported_model";
      return null;
    }
  }

  // Format gate: Claude always ok; OpenAI only for supported Blackbox Fable aliases.
  // Other formats stay unsupported_format (legacy object shape).
  const openaiFable = format === FORMATS.OPENAI && isSupportedModel(format, model);
  if (format !== FORMATS.CLAUDE && !openaiFable) {
    return skipped("unsupported_format", { detail: format });
  }

  if (!body) {
    const r = skipped("missing_body");
    if (diagnostics) diagnostics.reason = r.reason;
    return r;
  }
  if (typeof transform !== "function") {
    // pxpipe-stage contract: when supported model but no transform, prefer
    // not_profitable so the caller treats it as a profitability skip.
    // Legacy callers still get not_installed.
    const reason = isNewContract && isSupportedModel(format, model) ? "not_profitable" : "not_installed";
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

  // Transform speaks Anthropic Messages. OpenAI Fable bodies are normalized first
  // and restored to OpenAI shape after a successful apply.
  const prepared = prepareTransformBody(body, format, model);
  if (!prepared) {
    return skipped("unsupported_format", { detail: format || "unknown" });
  }

  try {
    const encoded = new TextEncoder().encode(JSON.stringify(prepared.transformBody));
    const budget = Number(timeoutMs) > 0 ? Number(timeoutMs) : DEFAULT_TIMEOUT_MS;
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

    const transformedClaude = JSON.parse(new TextDecoder().decode(result.body));
    const newBody = prepared.restore(transformedClaude);
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
