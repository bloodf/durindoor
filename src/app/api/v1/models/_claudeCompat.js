import { resolveModelLimits } from "open-sse/providers/capabilities.js";
import { isString } from "../../../../shared/utils/typeChecks.js";

const CLAUDE_PREFIX = "claude-";
const CONTEXT_MARKER = /\[1m\]$/i;
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

/** Decode only catalog-projected or recognized `[1m]` request spellings. */
export async function decodeClaudeCodeModelId(model, isRoutable) {
  if (!isString(model) || !model) return model;

  if (await isRoutable(model, { exact: true })) return model;
  const marker = CONTEXT_MARKER.test(model);
  const unmarked = marker ? model.replace(CONTEXT_MARKER, "") : model;
  if (model.startsWith(CLAUDE_PREFIX)) {
    // Prefer the exact emitted route first: a genuine configured ID may itself
    // end in `[1m]` (for example `kimi/k3[1m]`).
    const projectedExact = model.slice(CLAUDE_PREFIX.length);
    if (await isRoutable(projectedExact, { exact: true })) return projectedExact;

    const projected = unmarked.slice(CLAUDE_PREFIX.length);
    if (await isRoutable(projected)) return projected;
  }
  if (marker && await isRoutable(unmarked)) return unmarked;
  return model;
}
