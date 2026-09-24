// Adaptive reasoning-effort wiring (port of OmniRoute #13448). Semantics live
// in open-sse/services/adaptiveEffort.js; this module only adapts the
// chatCore call-site context (headers, translated body, target format).
//
// Scoped to FORMATS.OPENAI dispatch: `reasoning_effort` is an OpenAI
// Chat-Completions-shaped field. On any other target it either does nothing
// (Claude/Gemini executors read `thinking` / `reasoning.effort` instead) or,
// worse, reaches an upstream that rejects unrecognized top-level parameters.
import { applyAdaptiveEffort, hasExplicitReasoningField, isAdaptiveEffort } from "../../services/adaptiveEffort.js";
import { FORMATS } from "../../translator/formats.js";
import { isFunction, isObject, isString } from "../../../src/shared/utils/typeChecks.js";

const EFFORT_HEADER = "x-durindoor-effort";

function readHeaderValue(headers, name) {
  if (!headers) return undefined;
  if (isFunction(headers.get)) {
    const v = headers.get(name);
    return v === null || v === undefined ? undefined : String(v);
  }
  if (isObject(headers) && !Array.isArray(headers)) {
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === name) {
        const v = headers[key];
        return v === null || v === undefined ? undefined : String(v);
      }
    }
  }
  return undefined;
}

/**
 * Resolve "auto" reasoning effort to a concrete level when the request opted
 * in via `X-DurinDoor-Effort: auto` and carries no explicit reasoning field.
 * Returns `body` unchanged (same reference) otherwise.
 */
export function wireAdaptiveEffort(body, ctx) {
  if (ctx?.targetFormat !== FORMATS.OPENAI) return body;
  if (!body || !isObject(body) || Array.isArray(body)) return body;
  if (hasExplicitReasoningField(body)) return body;
  const headerEffort = isString(ctx?.headerEffort) ?
  ctx.headerEffort :
  readHeaderValue(ctx?.clientRawRequest?.headers, EFFORT_HEADER);
  if (!isAdaptiveEffort(headerEffort)) return body;
  return applyAdaptiveEffort(body, {
    messages: ctx?.rawBody?.messages,
    headerEffort
  });
}
