import { resolveProviderAlias } from "open-sse/services/model.js";

/** Canonicalize a policy identity without resolving user-defined model aliases. */import { isString } from "@/shared/utils/typeChecks.js";
export function canonicalizePolicyModelIdentity(identity) {
  if (!isString(identity)) return identity;
  const trimmed = identity.trim();
  if (!trimmed) return trimmed;
  const slash = trimmed.indexOf("/");
  if (slash < 0) return resolveProviderAlias(trimmed);
  const provider = resolveProviderAlias(trimmed.slice(0, slash));
  return `${provider}/${trimmed.slice(slash + 1)}`;
}

export function canonicalizePolicyAllowedModels(models = []) {
  return [...new Set(models.map(canonicalizePolicyModelIdentity))];
}