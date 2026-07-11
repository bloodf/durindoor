// Re-export from open-sse with localDb integration
import { getModelAliases, getComboByName, getProviderNodes, getProviderConnections } from "@/lib/localDb";
import { parseModel as parseModelCore, resolveModelAliasFromMap, getModelInfoCore } from "open-sse/services/model.js";
import { isAutoComboId, familyOfAutoId, resolveAutoCombo } from "open-sse/services/autoComboResolver.js";
import REGISTRY from "open-sse/providers/registry/index.js";
import { PROVIDER_MODELS } from "open-sse/providers/index.js";

// Local provider alias overrides (HMR-friendly, applied on top of open-sse map)
const LOCAL_PROVIDER_ALIASES = {
  xmtp: "xiaomi-tokenplan",
  "xiaomi-tokenplan": "xiaomi-tokenplan",
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

/**
 * Get full model info (parse or resolve)
 */
export async function getModelInfo(modelStr) {
  const parsed = parseModel(modelStr);

  if (!parsed.isAlias) {
    // Provider-node prefixes are user-defined. They must not override built-in
    // provider ids/aliases such as `cf`, `cloudflare-ai`, `openai`, or `hf`.
    if (!RESERVED_PROVIDER_PREFIXES.has(parsed.providerAlias)) {
      const openaiNodes = await getProviderNodes({ type: "openai-compatible" });
      const matchedOpenAI = openaiNodes.find((node) => node.prefix === parsed.providerAlias);
      if (matchedOpenAI) {
        return { provider: matchedOpenAI.id, model: parsed.model };
      }

      const anthropicNodes = await getProviderNodes({ type: "anthropic-compatible" });
      const matchedAnthropic = anthropicNodes.find((node) => node.prefix === parsed.providerAlias);
      if (matchedAnthropic) {
        return { provider: matchedAnthropic.id, model: parsed.model };
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
  const combo = await getComboByName(parsed.model);
  if (combo) {
    // Return null provider to signal this should be handled as combo
    // The caller (handleChat) will detect this and handle it as combo
    return { provider: null, model: parsed.model };
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
  const catalog = {};
  for (const conn of connections) {
    if (!conn || conn.isActive === false) continue;
    const key = idToKey.get(conn.provider) || conn.provider;
    const models = PROVIDER_MODELS[key];
    if (!Array.isArray(models) || models.length === 0) continue;
    if (!catalog[key]) catalog[key] = models;
  }
  return catalog;
}

/**
 * Check if model is a combo and get models list.
 * `auto/<family>` ids resolve BEFORE the slash guard and DB lookup: they are
 * virtual combos materialized from the active-connections catalog. A recognized
 * auto id always returns an array (possibly empty) — never null — so callers
 * enter the combo path and fail fast on an empty pool rather than falling
 * through to a literal "auto" provider or a DB miss.
 * @param {string} modelStr
 * @param {Object} [settings] - already-loaded settings (avoids duplicate reads)
 * @returns {Promise<string[]|null>} Array of models (empty for empty auto pool), or null if not a combo
 */
export async function getComboModels(modelStr, settings) {
  if (isAutoComboId(modelStr)) {
    const family = familyOfAutoId(modelStr);
    const catalog = await getAutoComboCatalog();
    return resolveAutoCombo(family, catalog, settings);
  }

  // Only check if it's not in provider/model format
  if (modelStr.includes("/")) return null;

  const combo = await getComboByName(modelStr);
  if (combo && combo.models && combo.models.length > 0) {
    return combo.models;
  }
  return null;
}
