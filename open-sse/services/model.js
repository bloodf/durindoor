import REGISTRY from "../providers/registry/index.js";
import { detectRequiredCapabilities } from "./combo.js";
import { getCapabilitiesForModel } from "../providers/capabilities.js";

// Alias→id derived from registry single-source: id→id, alias→id, aliases[]→id.
// Media-only providers without a registry transport entry keep explicit aliases here.
import { isFunction, isObject, isString } from "../../src/shared/utils/typeChecks.js";
const MEDIA_ONLY_ALIASES = {
  el: "elevenlabs",
  jina: "jina-ai",
  "jina-ai": "jina-ai",
  polly: "aws-polly",
  "aws-polly": "aws-polly"
};

const ALIAS_TO_PROVIDER_ID = { ...MEDIA_ONLY_ALIASES };
for (const entry of REGISTRY) {
  ALIAS_TO_PROVIDER_ID[entry.id] = entry.id;
  if (entry.alias) ALIAS_TO_PROVIDER_ID[entry.alias] = entry.id;
  if (entry.uiAlias && entry.uiAlias !== entry.alias) ALIAS_TO_PROVIDER_ID[entry.uiAlias] = entry.id;
  for (const a of entry.aliases || []) ALIAS_TO_PROVIDER_ID[a] = entry.id;
}

/**
 * Strip a redundant leading `${nodePrefix}/` segment from a model id.
 *
 * Port of OmniRoute #6890. When a custom provider node is addressed by its raw
 * internal connection id (`<connId>/<modelStr>` — e.g. a combo step), the
 * caller may have naively concatenated the node's `prefix` (the `owned_by`
 * emitted by /api/models) with the listed model id, producing
 * `<connId>/<prefix>/<rawModelId>`. The upstream provider does not recognize
 * the double-namespaced id and 400s. Stripping normalizes it to the same
 * `<rawModelId>` the bare alias form (`<prefix>/<rawModelId>`) resolves to.
 *
 * @param {string} model - model id as parsed after the first slash
 * @param {unknown} nodePrefix - the matched node's own prefix
 * @returns {string} model with one redundant leading `${nodePrefix}/` removed
 */
export function stripRedundantNodePrefix(model, nodePrefix) {
  if (!isString(nodePrefix) || !nodePrefix) return model;
  const redundant = `${nodePrefix}/`;
  return isString(model) && model.startsWith(redundant) ?
  model.slice(redundant.length) :
  model;
}

/**
 * Resolve provider alias to provider ID
 */
export function resolveProviderAlias(aliasOrId) {
  return ALIAS_TO_PROVIDER_ID[aliasOrId] || aliasOrId;
}

/**
 * Parse model string: "alias/model" or "provider/model" or just alias
 */
export function parseModel(modelStr) {
  if (!modelStr) {
    return { provider: null, model: null, isAlias: false, providerAlias: null };
  }

  // Check if standard format: provider/model or alias/model
  if (modelStr.includes("/")) {
    const firstSlash = modelStr.indexOf("/");
    const providerOrAlias = modelStr.slice(0, firstSlash);
    const model = modelStr.slice(firstSlash + 1);
    const provider = resolveProviderAlias(providerOrAlias);
    return { provider, model, isAlias: false, providerAlias: providerOrAlias };
  }

  // Alias format (model alias, not provider alias)
  return {
    provider: null,
    model: modelStr,
    isAlias: true,
    providerAlias: null
  };
}

/**
 * Resolve model alias from aliases object
 * Format: { "alias": "provider/model" }
 */
export function resolveModelAliasFromMap(alias, aliases) {
  if (!aliases) return null;

  // Check if alias exists
  const resolved = aliases[alias];
  if (!resolved) return null;

  // Resolved value is "provider/model" format
  if (isString(resolved) && resolved.includes("/")) {
    const firstSlash = resolved.indexOf("/");
    const providerOrAlias = resolved.slice(0, firstSlash);
    return {
      provider: resolveProviderAlias(providerOrAlias),
      model: resolved.slice(firstSlash + 1)
    };
  }

  // Or object { provider, model }
  if (isObject(resolved) && resolved.provider && resolved.model) {
    return {
      provider: resolveProviderAlias(resolved.provider),
      model: resolved.model
    };
  }

  return null;
}

/**
 * Get full model info (parse or resolve)
 * @param {string} modelStr - Model string
 * @param {object|function} aliasesOrGetter - Aliases object or async function to get aliases
 */
export async function getModelInfoCore(modelStr, aliasesOrGetter) {
  const parsed = parseModel(modelStr);

  if (!parsed.isAlias) {
    return {
      provider: parsed.provider,
      model: parsed.model
    };
  }

  // Get aliases (from object or function)
  const aliases =
  isFunction(aliasesOrGetter) ?
  await aliasesOrGetter() :
  aliasesOrGetter;

  // Resolve alias
  const resolved = resolveModelAliasFromMap(parsed.model, aliases);
  if (resolved) {
    return resolved;
  }

  // Fallback: infer provider from model name prefix
  return {
    provider: inferProviderFromModelName(parsed.model),
    model: parsed.model
  };
}

// Config-driven prefix → provider inference (first match wins, fallback "openai").
const MODEL_PREFIX_PROVIDERS = [
[/^claude-/, "anthropic"],
[/^gemini-/, "gemini"],
[/^gpt-/, "openai"],
[/^o[134]/, "openai"],
[/^deepseek-/, "openrouter"]];


/**
 * Infer provider from model name prefix
 * Used as fallback when no provider prefix or alias is given
 */
function inferProviderFromModelName(modelName) {
  if (!modelName) return "openai";
  const m = modelName.toLowerCase();
  return MODEL_PREFIX_PROVIDERS.find(([re]) => re.test(m))?.[1] || "openai";
}

/**
 * Validate an operator-configured vision-bridge target. The target must be a
 * non-empty "provider/model" string whose capabilities report vision === true;
 * otherwise the reroute would hand images to a text-only model and silently
 * strip them downstream. Returns the normalized id or null when invalid.
 */
function validateVisionTarget(target, targetCapabilities = null) {
  if (!isString(target)) return null;
  const trimmed = target.trim();
  if (!trimmed) return null;
  const parsed = parseModel(trimmed);
  if (!parsed.provider || !parsed.model) return null;
  // Custom-model overrides (vision persisted on the custom record) validate
  // the target even when the static catalog says non-vision.
  const caps = targetCapabilities || getCapabilitiesForModel(parsed.provider, parsed.model);
  return caps?.vision === true ? `${parsed.provider}/${parsed.model}` : null;
}

/**
 * Vision Bridge reroute (port of OmniRoute #6640).
 *
 * When a chat request carries image parts on its CURRENT user turn and the
 * requested model cannot accept vision natively, swap body.model to a
 * vision-capable model so the upstream sees the images directly. Combos,
 * aliases, vision-capable models, and disabled bridge are all passthrough.
 *
 * Pure w.r.t. persistence: settings is passed in by the caller (already loaded
 * in the chat path), so this never touches the DB and parseModel stays sync.
 *
 * @param {object} args
 * @param {object} args.body        parsed request body (mutated copy returned)
 * @param {string} args.modelStr    current "provider/model" or combo/alias name
 * @param {object} [args.settings]  settings snapshot from getSettings()
 * @returns {{ body: object, modelStr: string, rerouted: boolean, fromModel?: string, toModel?: string }}
 */
export function applyVisionBridgeReroute({ body, modelStr, settings, capabilities = null, targetCapabilities = null } = {}) {
  if (!body || !isObject(body) || !isString(modelStr)) {
    return { body, modelStr, rerouted: false };
  }
  if (settings?.visionBridgeEnabled !== true) {
    return { body, modelStr, rerouted: false };
  }
  // Combos resolve their own vision-capable members; auto/* delegates to the
  // auto-combo resolver. Aliases (no slash) are resolved later — never reroute
  // before we know the concrete provider/model.
  if (!modelStr.includes("/") || modelStr === "auto" || modelStr.startsWith("auto/")) {
    return { body, modelStr, rerouted: false };
  }
  // Only fire when the current user turn actually carries an image.
  const required = detectRequiredCapabilities(body);
  if (!required.has("vision")) {
    return { body, modelStr, rerouted: false };
  }
  // Already vision-capable — let the upstream handle it natively.
  const parsed = parseModel(modelStr);
  const currentCaps = capabilities || getCapabilitiesForModel(parsed.provider, parsed.model);
  if (currentCaps?.vision === true) {
    return { body, modelStr, rerouted: false };
  }
  // Vision Bridge requires an explicit operator-configured target that is
  // itself vision-capable. The reroute helper cannot know which providers have
  // live credentials, so auto-picking an arbitrary registry vision model could
  // hand the request to a provider with no active connection and break it. An
  // empty/missing/invalid target therefore PASSTHROUGHS (request stays on the
  // original non-vision model) rather than guessing.
  const target = validateVisionTarget(settings?.visionBridgeModel, targetCapabilities);
  if (!target) return { body, modelStr, rerouted: false };
  if (target === `${parsed.provider}/${parsed.model}`) {
    return { body, modelStr, rerouted: false };
  }
  return {
    body: { ...body, model: target },
    modelStr: target,
    rerouted: true,
    fromModel: modelStr,
    toModel: target
  };
}