import { resolveProviderAlias } from "open-sse/services/model.js";
import REGISTRY from "open-sse/providers/registry/index.js";

/** Canonicalize a policy identity without resolving user-defined model aliases. */
import { isString } from "../../shared/utils/typeChecks.js";
export function canonicalizePolicyModelIdentity(identity) {
  if (!isString(identity)) return identity;
  const trimmed = identity.trim();
  if (!trimmed) return trimmed;
  const slash = trimmed.indexOf("/");
  if (slash < 0) return resolveProviderAlias(trimmed);
  const provider = resolveProviderAlias(trimmed.slice(0, slash));
  const model = trimmed.slice(slash + 1);
  const entry = REGISTRY.find((item) => item.id === provider);
  // Older catalogs stripped a provider prefix from vendor model IDs.
  const models = [...(entry?.models || []), ...Object.values(entry || {}).flatMap((value) => value?.models || [])];
  const prefixed = `${provider}/${model}`;
  return `${provider}/${!models.some((item) => item.id === model) && models.some((item) => item.id === prefixed) ? prefixed : model}`;
}

export function canonicalizePolicyAllowedModels(models = []) {
  return [...new Set(models.map(canonicalizePolicyModelIdentity))];
}