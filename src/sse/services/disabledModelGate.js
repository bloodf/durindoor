import { getDisabledModels } from "@/lib/disabledModelsDb";
import { getProviderNodes } from "@/lib/localDb";
import { resolveProviderId } from "@/shared/constants/providers.js";
import REGISTRY from "open-sse/providers/registry/index.js";
import { isString } from "@/shared/utils/typeChecks.js";

/**
 * Whether the dashboard's disabled-model list (POST /api/models/disabled)
 * turns off `model` on `provider` (upstream 9router #4318). The list is keyed
 * by provider id, alias, or compatible-node prefix, so every name the provider
 * goes by is checked, as combo member filtering does in model.js. Fails open:
 * a lookup error never blocks routing.
 * @param {string} provider - Provider id, alias, or compatible-node id
 * @param {string} model - Provider model id
 * @returns {Promise<boolean>}
 */
export async function isProviderModelDisabled(provider, model) {
  if (!isString(provider) || !provider || !isString(model) || !model) return false;
  try {
    const disabledByProvider = await getDisabledModels();
    if (!Object.values(disabledByProvider || {}).some((ids) => Array.isArray(ids) && ids.length)) return false;

    const providerId = resolveProviderId(provider);
    const keys = new Set([provider, providerId]);
    const owner = REGISTRY.find((entry) => entry.id === providerId);
    if (owner?.alias) keys.add(owner.alias);
    if (owner?.uiAlias) keys.add(owner.uiAlias);
    for (const alias of owner?.aliases || []) keys.add(alias);
    if (!owner) {
      const nodes = await getProviderNodes();
      const node = nodes.find((entry) => entry.id === provider || entry.prefix === provider);
      if (node) {
        keys.add(node.id);
        keys.add(node.prefix);
      }
    }
    return [...keys].some((key) => disabledByProvider[key]?.includes(model));
  } catch {
    return false;
  }
}
