import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";

import { parseSuffix } from "open-sse/translator/concerns/thinkingSuffix.js";
import { PROVIDER_ID_TO_ALIAS } from "open-sse/config/providerModels.js";
import { isObject, isString } from "../../shared/utils/typeChecks.js";

export function resolveCustomCapabilities(provider, model, requestPrefix, customModels) {
  if (!Array.isArray(customModels) || !model) return null;
  const { cleanModel } = parseSuffix(model);
  const cleanModelId = String(cleanModel).replace(/^\//, "");
  const canonicalAlias = PROVIDER_ID_TO_ALIAS[provider] || provider;
  for (const m of customModels) {
    if (!m.id || !m.providerAlias) continue;
    // The same provider/model id may carry sibling records of other types
    // (image, embedding). Chat capability resolution reads only LLM records.
    // Same fallback as providerCustomModels: kind || type || "llm".
    if ((m.kind || m.type || "llm") !== "llm") continue;
    const storedId = String(m.id).replace(/^\//, "");
    if (storedId !== cleanModelId) continue;
    const alias = m.providerAlias;
    if (alias === provider || alias === requestPrefix || alias === canonicalAlias) {
      const staticCaps = getCapabilitiesForModel(provider, String(cleanModel));
      const caps = m.capabilities;
      const hasCaps = caps && isObject(caps) && !Array.isArray(caps) && Object.keys(caps).length > 0;
      const merged = hasCaps ? { ...staticCaps, ...caps } : { ...staticCaps };
      // Consumers that must distinguish "explicitly persisted on the custom
      // row" from "inherited static/default" (e.g. strict context routing)
      // read this non-enumerable marker; spreads/JSON drop it harmlessly.
      Object.defineProperty(merged, "customKeys", {
        value: new Set(hasCaps ? Object.keys(caps) : []),
        enumerable: false
      });
      return merged;
    }
  }
  return null;
}

// Async wrapper owning the DB lookup so callers (chat handler) don't fetch
// the whole custom-model catalog themselves — keeps localDb mocking scoped
// to this service's tests. Fail-open: lookup errors mean "no custom caps".
export async function loadCustomCapabilities(provider, model, requestPrefix) {
  try {
    const customModels = await getCustomModels();
    const direct = resolveCustomCapabilities(provider, model, requestPrefix, customModels);
    if (direct) return direct;
    // Compatible-provider nodes store custom rows under the node PREFIX as
    // providerAlias, while getModelInfo resolves to the internal node id. A
    // bare alias (requestPrefix null) or id-addressed request would miss the
    // row, so retry with the node's prefix as the effective alias.
    if (provider && (provider.startsWith("openai-compatible") || provider.startsWith("anthropic-compatible") || /^[0-9a-f-]{16,}$/i.test(provider))) {
      const nodes = [
      ...(await getProviderNodes({ type: "openai-compatible" })),
      ...(await getProviderNodes({ type: "anthropic-compatible" }))];

      const node = nodes.find((n) => n.id === provider);
      if (node?.prefix && node.prefix !== requestPrefix) {
        return resolveCustomCapabilities(provider, model, node.prefix, customModels);
      }
    }
    return null;
  } catch {
    return null;
  }
}

// Re-export from open-sse with localDb integration
import { isFreeNoAuthProviderDisabled } from "@/sse/services/freeProviderGate.js";
import {
  getModelAliases,
  getCombos,
  getComboForModel,
  getProviderNodes,
  getProviderConnections,
  getCustomModels,
  getSettings } from
"@/lib/localDb";
import { parseModel as parseModelCore, resolveModelAliasFromMap, getModelInfoCore, stripRedundantNodePrefix } from "open-sse/services/model.js";
import { filterPaidModels } from "open-sse/providers/pricing.js";
import { isAutoComboId, familyOfAutoId, resolveAutoCombo } from "open-sse/services/autoComboResolver.js";
import { applyNoAuthAutoComboGate } from "open-sse/services/combo.js";
import { NOAUTH_PROVIDERS } from "open-sse/config/providers.js";
import REGISTRY from "open-sse/providers/registry/index.js";
import { PROVIDER_MODELS } from "open-sse/providers/index.js";
import { getDisabledModels } from "@/lib/disabledModelsDb";

// Local provider alias overrides (HMR-friendly, applied on top of open-sse map)
const LOCAL_PROVIDER_ALIASES = {
  xmtp: "xiaomi-tokenplan",
  "xiaomi-tokenplan": "xiaomi-tokenplan"
};

const RESERVED_PROVIDER_PREFIXES = new Set(Object.keys(LOCAL_PROVIDER_ALIASES));
for (const entry of REGISTRY) {
  RESERVED_PROVIDER_PREFIXES.add(entry.id);
  if (entry.alias) RESERVED_PROVIDER_PREFIXES.add(entry.alias);
  if (entry.uiAlias) RESERVED_PROVIDER_PREFIXES.add(entry.uiAlias);
  for (const alias of entry.aliases || []) RESERVED_PROVIDER_PREFIXES.add(alias);
}

export function parseModel(modelStr) {
  const parsed = parseModelCore(modelStr);
  if (parsed?.providerAlias && LOCAL_PROVIDER_ALIASES[parsed.providerAlias]) {
    return { ...parsed, provider: LOCAL_PROVIDER_ALIASES[parsed.providerAlias] };
  }
  return parsed;
}

/**
 * Resolve model alias from localDb
 */
export async function resolveModelAlias(alias) {
  const aliases = await getModelAliases();
  return resolveModelAliasFromMap(alias, aliases);
}

const DOCUMENTED_BRACKET_MODEL = /^(glm-5\.3|k3)\[1m\]$/i;

function registryHasModel(modelStr) {
  const parsed = parseModel(modelStr);
  if (!parsed.providerAlias || !parsed.model) return false;
  const registry = REGISTRY.find((entry) =>
    entry.id === parsed.provider || entry.alias === parsed.providerAlias ||
    entry.uiAlias === parsed.providerAlias || entry.aliases?.includes(parsed.providerAlias));
  if (!registry) return false;
  const requested = DOCUMENTED_BRACKET_MODEL.test(parsed.model)
    ? parsed.model.replace(/\[1m\]$/i, "")
    : parsed.model;
  return registry.models?.some((model) =>
    (model.id === requested && (requested === parsed.model || DOCUMENTED_BRACKET_MODEL.test(parsed.model))) ||
    model.aliases?.includes(parsed.model)) === true;
}

/** Build one request-scoped routability checker over one snapshot of DB sources. */
export function createRoutableModelIdChecker() {
  let sourcesPromise;
  const loadSources = () => sourcesPromise ||= Promise.all([
    getCombos(),
    getModelAliases(),
    getProviderNodes({ type: "openai-compatible" }),
    getProviderNodes({ type: "anthropic-compatible" }),
    getCustomModels(),
  ]);

  return async (modelStr) => {
    if (!modelStr) return false;
    if (registryHasModel(modelStr)) return true;

    const [combos, aliases, openaiNodes, anthropicNodes, customModels] = await loadSources();
    if (combos.some((combo) => combo.name?.toLowerCase() === modelStr.toLowerCase())) return true;
    if (resolveModelAliasFromMap(modelStr, aliases)) return true;

    const parsed = parseModel(modelStr);
    if (!parsed.providerAlias || !parsed.model) return false;
    if ([...openaiNodes, ...anthropicNodes].some((node) =>
      node.id === parsed.providerAlias || node.prefix === parsed.providerAlias)) return true;
    return customModels.some((model) =>
      model.providerAlias === parsed.providerAlias && model.id === parsed.model);
  };
}

/**
 * Get full model info (parse or resolve)
 */
export async function getModelInfo(modelStr) {
  const parsed = parseModel(modelStr);

  if (!parsed.isAlias) {
    // Provider-node prefixes are user-defined. They must not override built-in
    // provider ids/aliases such as `cf`, `cloudflare-ai`, `openai`, or `hf`.
    if (!RESERVED_PROVIDER_PREFIXES.has(parsed.providerAlias)) {
      // Custom nodes can be addressed by alias (node.prefix) OR by raw
      // internal node.id (e.g. a combo step `<connId>/<model>`). The id form
      // never split parsed.model on the node's prefix, so a naive
      // `owned_by`+id concat (`<connId>/<prefix>/<rawModelId>`) would 400
      // upstream double-namespaced. Port of OmniRoute #6890: match both
      // addressing forms and strip one redundant leading `<prefix>/`.
      const openaiNodes = await getProviderNodes({ type: "openai-compatible" });
      const matchedOpenAI = openaiNodes.find((node) => node.prefix === parsed.providerAlias || node.id === parsed.providerAlias);
      if (matchedOpenAI) {
        return { provider: matchedOpenAI.id, model: stripRedundantNodePrefix(parsed.model, matchedOpenAI.prefix) };
      }

      const anthropicNodes = await getProviderNodes({ type: "anthropic-compatible" });
      const matchedAnthropic = anthropicNodes.find((node) => node.prefix === parsed.providerAlias || node.id === parsed.providerAlias);
      if (matchedAnthropic) {
        return { provider: matchedAnthropic.id, model: stripRedundantNodePrefix(parsed.model, matchedAnthropic.prefix) };
      }

      const embeddingNodes = await getProviderNodes({ type: "custom-embedding" });
      const matchedEmbedding = embeddingNodes.find((node) => node.prefix === parsed.providerAlias);
      if (matchedEmbedding) {
        return { provider: matchedEmbedding.id, model: parsed.model };
      }
    }
    return {
      provider: parsed.provider,
      model: parsed.model
    };
  }

  // Check if this is a combo name before resolving as alias
  // This prevents combo names from being incorrectly routed to providers
  const combo = await getComboForModel(parsed.model);
  if (combo) {
    // Return the persisted name so downstream combo routing preserves casing.
    return { provider: null, model: combo.name };
  }

  return getModelInfoCore(modelStr, getModelAliases);
}

/**
 * Build the auto-combo catalog: the subset of PROVIDER_MODELS served by
 * currently-active provider connections. Auto-combo pools span whatever is
 * actually connected — never the full bundled registry (which lists every
 * provider we support, connected or not).
 *
 * Connection rows carry `provider` (registry id) + `isActive`. PROVIDER_MODELS
 * is keyed by registry alias/id. We map active connection provider ids through
 * the registry so ids and aliases both resolve, then intersect.
 *
 * @returns {Promise<Object>} PROVIDER_MODELS-shaped map { [alias]: Array<{id}> }
 */
export async function getAutoComboCatalog() {
  // DB errors propagate: a connection-store failure must not masquerade as an
  // empty auto-combo pool (which would fail a request the caller might have
  // served). Callers handle/report the error at their layer.
  const connections = (await getProviderConnections()) || [];
  // Registry id → alias used as PROVIDER_MODELS key.
  const idToKey = new Map();
  for (const entry of REGISTRY) {
    const key = entry.alias || entry.id;
    idToKey.set(entry.id, key);
    if (entry.alias) idToKey.set(entry.alias, key);
  }
  // Chat-eligible no-auth entries come from the canonical config (registry
  // derived — never a hardcoded provider list). Drop any disabled by the
  // free-provider enable toggle.
  const settings = await getSettings().catch(() => null);
  const noAuthEntries = Object.values(NOAUTH_PROVIDERS).filter(
    (entry) => !isFreeNoAuthProviderDisabled(entry.id, settings)
  );
  const getModels = (key) => PROVIDER_MODELS[key];
  const catalog = {};
  const inactiveKeys = new Set();
  for (const conn of connections) {
    if (!conn) continue;
    const key = idToKey.get(conn.provider) || conn.provider;
    const models = PROVIDER_MODELS[key];
    if (!Array.isArray(models) || models.length === 0) continue;
    if (conn.isActive === false) {
      // #6557: remember a fully-disabled provider so its default no-auth seat
      // is suppressed below; an active row for the same provider still wins
      // (seated by the active-row path later in this loop).
      inactiveKeys.add(key);
      continue;
    }
    if (!catalog[key]) catalog[key] = models;
  }
  // #6557 / OmniRoute #6889: no-auth providers enter the pool by DEFAULT
  // (zero-row synthetic seat); the gate drops only those explicitly disabled
  // via their own connection row's isActive=false. Active rows are already
  // seated in the loop above, so an enabled provider-account still wins.
  for (const key of applyNoAuthAutoComboGate({ idToKey, noAuthEntries, getModels, inactiveKeys })) {
    if (!catalog[key]) catalog[key] = PROVIDER_MODELS[key];
  }
  return catalog;
}


/**
 * Check if model is a combo and get models list.
 *
 * `auto/<family>` ids (F-2 auto-combo) resolve BEFORE the slash guard and DB
 * lookup: virtual combos materialized from the active-connections catalog. A
 * recognized auto id always returns an array (possibly empty) — never null — so
 * callers enter the combo path and fail fast on an empty pool rather than
 * falling through to a literal "auto" provider or a DB miss. `resolveAutoCombo`
 * is pure over the catalog (settings ignored), so the second argument stays the
 * F-4 boolean.
 *

 * When `hidePaidModels` is true (#6495 / F-4), paid members of a SAVED combo are
 * filtered out via pricing.js so chat/image/TTS combo routing honor the toggle.
 * The saved combo object is never mutated. Default `false` keeps ACL existence
 * checks (which must see the real combo) and any caller that did not load
 * settings a passthrough with NO settings DB read. Routing handlers already hold
 * `settings` and pass `settings.hidePaidModels === true`. Toggle off returns the
 * original array reference so identity-sensitive callers and the "off === full
 * list" contract hold.
 *
 * @param {string} modelStr
 * @param {boolean} [hidePaidModels=false]
 * @returns {Promise<string[]|null>} Array of models (empty for empty auto pool), or null if not a combo
 */
function buildDisabledComboMemberMatcher(disabledByProvider, aliases, nodes) {
  const nodeRows = Array.isArray(nodes) ? nodes : [];

  return (member) => {
    if (!isString(member)) return false;
    let parsed = parseModel(member);
    if (parsed.isAlias) {
      const resolved = resolveModelAliasFromMap(member, aliases);
      if (!resolved) return false;
      parsed = { ...resolved, providerAlias: resolved.provider };
    }
    if (!parsed.providerAlias || !parsed.model) return false;

    const candidates = new Set([parsed.providerAlias]);
    const owner = REGISTRY.find((entry) => entry.id === parsed.provider) || REGISTRY.find((entry) =>
      entry.alias === parsed.providerAlias || entry.uiAlias === parsed.providerAlias || entry.aliases?.includes(parsed.providerAlias));
    if (owner?.id) candidates.add(owner.id);
    if (owner?.alias) candidates.add(owner.alias);
    if (owner?.uiAlias) candidates.add(owner.uiAlias);
    for (const alias of owner?.aliases || []) candidates.add(alias);

    const node = !RESERVED_PROVIDER_PREFIXES.has(parsed.providerAlias) && nodeRows.find((entry) =>
      entry.id === parsed.providerAlias || entry.prefix === parsed.providerAlias);
    if (node) {
      candidates.add(node.id);
      candidates.add(node.prefix);
    }
    return [...candidates].some((provider) => disabledByProvider?.[provider]?.includes(parsed.model));
  };
}

export async function getComboModels(modelStr, hidePaidModels = false) {
  if (isAutoComboId(modelStr)) {
    const family = familyOfAutoId(modelStr);
    const catalog = await getAutoComboCatalog();
    // F-4 #6495: filter paid auto-combo members through the same toggle as saved
    // combos so chat/image/TTS routing honors `hidePaidModels` uniformly.
    return filterPaidModels(resolveAutoCombo(family, catalog), hidePaidModels === true);
  }
  // Resolve a combo by its stored name only. A request containing a slash is
  // a real provider/model call — slash-basename lookup previously shadowed
  // genuine `provider/model` routing whenever a saved combo happened to share
  // the basename. Callers that still want provider-prefixed combo resolution
  // must save the combo under the full `provider/name` form.
  const combo = await getComboForModel(modelStr);
  if (!combo || !Array.isArray(combo.models)) return null;
  const disabledByProvider = await getDisabledModels().catch(() => ({}));
  if (!Object.values(disabledByProvider || {}).some((ids) => Array.isArray(ids) && ids.length)) {
    return filterPaidModels(combo.models, hidePaidModels === true);
  }
  const [aliases, openaiNodes, anthropicNodes] = await Promise.all([
    getModelAliases().catch(() => ({})),
    getProviderNodes({ type: "openai-compatible" }).catch(() => []),
    getProviderNodes({ type: "anthropic-compatible" }).catch(() => []),
  ]);
  const isDisabled = buildDisabledComboMemberMatcher(
    disabledByProvider,
    aliases,
    [...openaiNodes, ...anthropicNodes],
  );
  const enabledMembers = combo.models.filter((member) => !isDisabled(member));
  return filterPaidModels(enabledMembers.length === combo.models.length ? combo.models : enabledMembers, hidePaidModels === true);
}

// Canonical stored combo name for a request string, so ACL checks, per-combo
// strategy lookups, and rotation/scoring keys use the persisted spelling
// instead of whatever casing the client sent. Auto-combo ids (#F-2) are
// virtual — never stored — so they pass through unchanged. Returns null when
// `modelStr` is not a combo at all. Mirrors `getComboModels` above: a request
// with a slash is treated as a provider/model call, never a basename lookup.
export async function getComboCanonicalName(modelStr) {
  if (isAutoComboId(modelStr)) return modelStr;
  const combo = await getComboForModel(modelStr);
  return combo ? combo.name : null;
}