import { getApiKeyByKey, getProviderNodes } from "@/lib/localDb";
import { extractApiKey } from "./auth.js";
import { getProviderAlias, resolveProviderId } from "@/shared/constants/providers.js";
import { isString } from "@/shared/utils/typeChecks.js";

/**
 * Per-key model access rules stored in `policy.modelAccess`
 * (`{ mode: "all" | "allow" | "deny", patterns }`, normalized by
 * src/lib/db/helpers/apiKeyPolicy.js).
 *
 * Patterns are written against the ids `/v1/models` shows, so a model is
 * matched under every name it can be requested by: the string as given, the
 * canonical `providerId/model`, and the `alias/model` or provider-node
 * `prefix/model` form.
 */

const patternCache = new Map();

/** Case-insensitive glob match; `*` matches any run of characters, `/` included. */
export function matchesModelPattern(pattern, name) {
  if (!isString(pattern) || !isString(name)) return false;
  let regex = patternCache.get(pattern);
  if (!regex) {
    const source = pattern.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*");
    regex = new RegExp(`^${source}$`, "is");
    patternCache.set(pattern, regex);
  }
  return regex.test(name);
}

/** True when any candidate name passes the rule. A missing rule allows everything. */
export function isModelAccessAllowed(access, candidates) {
  if (!access || access.mode === "all" || !Array.isArray(access.patterns)) return true;
  const matched = access.patterns.some((pattern) => candidates.some((name) => matchesModelPattern(pattern, name)));
  return access.mode === "deny" ? !matched : matched;
}

/** Return `(modelStr) => string[]`, with provider nodes loaded once per call site. */
export async function getModelAccessCandidateBuilder() {
  const nodes = await getProviderNodes();
  const prefixById = new Map();
  const idByPrefix = new Map();
  for (const node of nodes) {
    if (!isString(node?.prefix) || !node.prefix) continue;
    prefixById.set(node.id, node.prefix);
    idByPrefix.set(node.prefix, node.id);
  }
  return (modelStr) => {
    if (!isString(modelStr) || !modelStr) return [];
    const names = new Set([modelStr]);
    const slash = modelStr.indexOf("/");
    if (slash > 0) {
      const model = modelStr.slice(slash + 1);
      const prefix = modelStr.slice(0, slash);
      const providerId = idByPrefix.get(prefix) || resolveProviderId(prefix);
      names.add(`${providerId}/${model}`);
      names.add(`${prefixById.get(providerId) || getProviderAlias(providerId)}/${model}`);
    }
    return [...names];
  };
}

/** Drop catalog entries (`{ id }`) the rule does not allow. */
export async function filterModelsByAccess(access, models) {
  if (!access || access.mode === "all") return models;
  const candidatesFor = await getModelAccessCandidateBuilder();
  return models.filter((entry) => isModelAccessAllowed(access, candidatesFor(entry.id)));
}

/** Filter a `/v1/models` list by the model access rule of the caller's key. */
export async function filterModelsForRequest(request, models) {
  const apiKey = extractApiKey(request);
  if (!apiKey) return models;
  const key = await getApiKeyByKey(apiKey);
  if (!key?.isActive) return models;
  return filterModelsByAccess(key.policy?.modelAccess, models);
}
