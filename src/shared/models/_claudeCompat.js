import { resolveModelLimits } from "open-sse/providers/capabilities.js";
import { isString } from "../utils/typeChecks.js";

const CLAUDE_PREFIX = "claude-";
// Advertisement marker. Only a proven 1M window may be advertised, so this
// stays `[1m]`: widening it would advertise a context size we cannot prove.
const CONTEXT_MARKER = /\[1m\]$/i;
// Decode marker. Claude Code appends a trailing context suffix to the model
// name when an extended context is toggled on (`claude-opus-5[1m]`,
// `claude-sonnet-5[200k]`). The suffix is a client-side annotation and never
// part of a model id, so it must be stripped before routing. The suffix is
// only recognized as the final token of the id.
const DECODE_CONTEXT_MARKER = /\[([0-9]+[mk])\]$/i;
const ONE_MILLION_TOKENS = 1_048_576;

/** Project one catalog row into the reversible ID shape Claude Code discovers. */
export function projectClaudeCodeModel(model, resolveLimits = resolveModelLimits) {
  const id = isString(model?.id) ? model.id : "";
  if (!id || (id.startsWith(CLAUDE_PREFIX) && !id.includes("/"))) return id;

  const provider = isString(model?.owned_by) && model.owned_by
    ? model.owned_by
    : id.split("/", 1)[0];
  const advertised = Number.isFinite(model?.context_length)
    ? { contextWindow: model.context_length, customKeys: new Set(["contextWindow"]) }
    : null;
  const limits = resolveLimits(provider, id, advertised);
  const projected = `${CLAUDE_PREFIX}${id}`;
  return limits?.known === true
    && limits.contextWindow >= ONE_MILLION_TOKENS
    && !CONTEXT_MARKER.test(id)
    ? `${projected}[1m]`
    : projected;
}

/** Decode only catalog-projected or recognized trailing context spellings. */
export async function decodeClaudeCodeModelId(model, isRoutable) {
  if (!isString(model) || !model) return model;

  if (await isRoutable(model, { exact: true })) return model;
  const marker = DECODE_CONTEXT_MARKER.test(model);
  const unmarked = marker ? model.replace(DECODE_CONTEXT_MARKER, "") : model;
  if (model.startsWith(CLAUDE_PREFIX)) {
    // Prefer the exact emitted route first: a genuine configured ID may itself
    // end in a context suffix (for example `kimi/k3[1m]`).
    const projectedExact = model.slice(CLAUDE_PREFIX.length);
    if (await isRoutable(projectedExact, { exact: true })) return projectedExact;

    const projected = unmarked.slice(CLAUDE_PREFIX.length);
    if (await isRoutable(projected)) return projected;
  }
  if (marker && await isRoutable(unmarked)) return unmarked;
  return model;
}
