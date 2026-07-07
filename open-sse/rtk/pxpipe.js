import { FORMATS } from "../translator/formats.js";
import { transformAnthropicMessages, transformOpenAIChatCompletions, transformOpenAIResponses } from "pxpipe-proxy";

// Compress Claude-format request bodies to context-images via pxpipe-proxy.
// Also supports OpenAI-compatible bodies when the provider route is OpenAI-format.
// Fail-open: any error or ineligibility returns null and leaves the body untouched.
export async function compressWithPxpipe(body, { enabled, model, format, diagnostics = null } = {}) {
  if (!enabled) {
    setDiagnostic(diagnostics, "compress_disabled");
    return null;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    setDiagnostic(diagnostics, "parse_error");
    return null;
  }

  try {
    if (format === FORMATS.CLAUDE) {
      return await compressAnthropic(body, model, diagnostics);
    }
    if (format === FORMATS.OPENAI || format === FORMATS.OPENAI_RESPONSES || format === FORMATS.OPENAI_RESPONSE) {
      return await compressOpenAI(body, model, format, diagnostics);
    }
    setDiagnostic(diagnostics, "unsupported_format");
    return null;
  } catch (e) {
    setDiagnostic(diagnostics, "transform_error");
    return null;
  }
}

async function compressAnthropic(body, model, diagnostics) {
  const encoded = new TextEncoder().encode(JSON.stringify(body));
  const res = await transformAnthropicMessages({ body: encoded, model });

  if (res.applied) {
    const next = JSON.parse(new TextDecoder().decode(res.body));
    replaceBody(body, next);
    return { applied: true, reason: res.reason, info: res.info };
  }

  setDiagnostic(diagnostics, res.reason);
  return null;
}

async function compressOpenAI(body, model, format, diagnostics) {
  const canonical = resolveOpenAIModel(model);
  if (!canonical) {
    setDiagnostic(diagnostics, "unsupported_model");
    return null;
  }
  const originalModel = body.model;
  body.model = canonical;
  const encoded = new TextEncoder().encode(JSON.stringify(body));
  const transform = format === FORMATS.OPENAI_RESPONSES || format === FORMATS.OPENAI_RESPONSE
    ? transformOpenAIResponses
    : transformOpenAIChatCompletions;
  const res = await transform(encoded, { compress: true });
  // Restore the upstream-facing model id so the provider still receives its expected alias.
  body.model = originalModel;
  if (res.info?.compressed) {
    const next = JSON.parse(new TextDecoder().decode(res.body));
    next.model = originalModel;
    replaceBody(body, next);
    return { applied: true, reason: "applied", info: res.info };
  }
  setDiagnostic(diagnostics, res.info?.reason || "not_profitable");
  return null;
}

function resolveOpenAIModel(model) {
  if (!model) return null;
  // Only accept direct OpenAI model ids and blackbox.ai OpenAI-style aliases.
  if (model.startsWith("blackboxai/anthropic/")) {
    const suffix = model.slice("blackboxai/anthropic/".length);
    // Map to the Anthropic-style canonical id that pxpipe supports on its OpenAI path.
    return suffix.replace(/^claude-/, "claude-");
  }
  if (model.startsWith("blackboxai/")) {
    return null;
  }
  return model;
}

function replaceBody(body, next) {
  for (const key of Object.keys(body)) {
    delete body[key];
  }
  Object.assign(body, next);
}

export function formatPxpipeLog(stats) {
  if (!stats || !stats.info) return null;
  const { origChars, compressedChars, imageCount } = stats.info;
  if (origChars === undefined || compressedChars === undefined) return null;
  return `${origChars}→${compressedChars} chars, ${imageCount ?? 0} image(s)`;
}

function setDiagnostic(diagnostics, reason) {
  if (diagnostics && !diagnostics.reason) diagnostics.reason = reason;
}
