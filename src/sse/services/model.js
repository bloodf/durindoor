// Re-export from open-sse with localDb integration
import { getModelAliases, getComboByName, getProviderNodes, getProviderConnections } from "@/lib/localDb";
import { parseModel as parseModelCore, resolveModelAliasFromMap, getModelInfoCore } from "open-sse/services/model.js";
import { resolveAutoCombo, isAutoComboId } from "open-sse/services/combo.js";
import { PROVIDER_MODELS } from "open-sse/providers/index.js";
import REGISTRY from "open-sse/providers/registry/index.js";

// Build the installed-provider catalog: active connections ∩ registry models.
// Auto-combo families must pool only providers the operator actually configured,
// never the full bundled registry (which lists every provider we support).
// Returns a { [alias]: Array<{id}|string> } map compatible with resolveAutoCombo.
export async function buildInstalledProviderCatalog() {
  let active = [];
  try {
    active = await getProviderConnections({ isActive: true });
  } catch {
    return {};
  }
  // Connections store the registry provider id; PROVIDER_MODELS is keyed by
  // entry.alias||entry.id. Map installed ids → their dispatch catalog key so a
  // provider whose alias differs from its id (e.g. alias="cf", id="cloudflare-ai")
  // is still recognised. Preserve the PROVIDER_MODELS key: downstream parseModel
  // expects that exact alias on the resolved `provider/model` string.
  const installedIds = new Set(active.map((c) => c.provider).filter(Boolean));
  const catalog = {};
  for (const entry of REGISTRY) {
    if (!installedIds.has(entry.id)) continue;
    const key = entry.alias || entry.id;
    if (PROVIDER_MODELS[key]) catalog[key] = PROVIDER_MODELS[key];
  }
  return catalog;
}

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
 * Check if model is a combo and get models list.
 * Recognises `auto/<family>` ids (auto/glm, auto/zai, …) which carry a slash
 * but are family auto-combos, not provider/model strings: they resolve against
 * the installed provider catalog. Honors settings.autoCombo enable/disable.
 * @param {string} modelStr
 * @param {Object} [settings] - settings slice (so autoCombo.enabled applies)
 * @returns {Promise<string[]|null>} Array of models, null if not a combo
 */
// Internal: resolve an auto-combo id against the installed catalog.
async function resolveAutoInstalled(modelStr, settings) {
  const installedCatalog = await buildInstalledProviderCatalog();
  return resolveAutoCombo(modelStr, { settings, catalog: installedCatalog });
}

// Internal: named (user-defined) combo lookup. Plain provider/model strings
// (slash-bearing, non-auto) return null.
async function resolveNamedCombo(modelStr) {
  if (modelStr.includes("/")) return null;
  const combo = await getComboByName(modelStr);
  if (combo && combo.models && combo.models.length > 0) return combo.models;
  return null;
}

/**
 * Check if model is a combo and get models list (legacy string[]/null contract).
 * Recognises `auto/<family>` ids (auto/glm, auto/zai, …) which carry a slash
 * but are family auto-combos, not provider/model strings: they resolve against
 * the installed provider catalog. Honors settings.autoCombo enable/disable.
 * @param {string} modelStr
 * @param {Object} [settings] - settings slice (so autoCombo.enabled applies)
 * @returns {Promise<string[]|null>} Array of models, null if not a combo or the
 *   auto-combo is disabled / resolves to an empty installed pool.
 */
export async function getComboModels(modelStr, settings) {
  if (isAutoComboId(modelStr)) {
    const auto = await resolveAutoInstalled(modelStr, settings);
    return auto && auto.members.length > 0 ? auto.members : null;
  }
  return resolveNamedCombo(modelStr);
}

/**
 * Single result shape for combo resolution. Unlike getComboModels (which keeps
 * the legacy string[]/null contract for named combos), this preserves the
 * auto-combo distinction between "not a combo", "disabled", and "empty pool"
 * so handlers can emit a precise 503 instead of a misleading provider 404.
 *
 * @returns {Promise<
 *   { kind: "combo", models: string[] } |
 *   { kind: "auto-empty", family: string, reason: string } |
 *   null
 * >}
 */
export async function getComboResolution(modelStr, settings) {
  if (isAutoComboId(modelStr)) {
    const auto = await resolveAutoInstalled(modelStr, settings);
    if (auto && auto.members.length > 0) return { kind: "combo", models: auto.members };
    const family = modelStr.slice("auto/".length);
    const reason = auto?.reason || `auto-combo "${family}" has no installed providers`;
    return { kind: "auto-empty", family, reason };
  }
  const models = await resolveNamedCombo(modelStr);
  if (models) return { kind: "combo", models };
  return null;
}
