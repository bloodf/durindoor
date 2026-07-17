import { normalizeApiKeyPolicy } from "@/lib/db/helpers/apiKeyPolicy.js";
import { getComboByName, getProviderNodes } from "@/lib/localDb";
import { getModelInfo, resolveModelAlias } from "@/sse/services/model.js";
import { AI_PROVIDERS, resolveProviderId } from "@/shared/constants/providers.js";

const POLICY_FIELDS = ["allowedModels", "maxTokens", "maxCostUsd"];
const UNRESTRICTED_POLICY = Object.freeze({ allowedModels: [], maxTokens: null, maxCostUsd: null });

export class ApiKeyPolicyInputError extends TypeError {
  constructor(message) {
    super(message);
    this.name = "ApiKeyPolicyInputError";
    this.code = "INVALID_API_KEY_POLICY";
  }
}

async function assertKnownPolicyProvider(providerId, originalModel) {
  if (AI_PROVIDERS[providerId]) return;
  const providerNodes = await getProviderNodes();
  if (!providerNodes.some((node) => node.id === providerId)) {
    throw new ApiKeyPolicyInputError(`Allowed model "${originalModel}" uses an unknown provider`);
  }
}

async function canonicalizeManagedModels(models) {
  const canonical = [];
  for (const model of models) {
    const trimmed = model.trim();
    if (await getComboByName(trimmed)) {
      throw new ApiKeyPolicyInputError(`Combo "${trimmed}" cannot be used as an allowed model`);
    }
    if (!trimmed.includes("/")) {
      const providerId = resolveProviderId(trimmed);
      const provider = AI_PROVIDERS[providerId];
      if (provider?.searchConfig || provider?.fetchConfig || provider?.searchViaChat) {
        canonical.push(providerId);
        continue;
      }
      const alias = await resolveModelAlias(trimmed);
      if (alias?.provider && alias?.model) {
        canonical.push(`${alias.provider}/${alias.model}`);
      } else {
        const resolved = await getModelInfo(trimmed);
        if (!resolved?.provider || !resolved?.model) {
          throw new ApiKeyPolicyInputError(`Allowed model "${trimmed}" could not be resolved`);
        }
        await assertKnownPolicyProvider(resolved.provider, trimmed);
        canonical.push(`${resolved.provider}/${resolved.model}`);
      }
      continue;
    }
    const resolved = await getModelInfo(trimmed);
    if (!resolved?.provider || !resolved?.model) {
      throw new ApiKeyPolicyInputError(`Allowed model "${trimmed}" could not be resolved`);
    }
    await assertKnownPolicyProvider(resolved.provider, trimmed);
    canonical.push(`${resolved.provider}/${resolved.model}`);
  }
  return [...new Set(canonical)];
}

async function normalizeManagedPolicy(value) {
  let policy;
  try {
    policy = normalizeApiKeyPolicy(value);
  } catch (error) {
    throw new ApiKeyPolicyInputError(error instanceof Error ? error.message : String(error));
  }
  // DB/provider lookup failures are operational errors and must reach the
  // route's sanitized 500 path rather than exposing their message as a 400.
  if (policy?.allowedModels) {
    policy.allowedModels = await canonicalizeManagedModels(policy.allowedModels);
  }
  return policy;
}

/**
 * Resolve policy input while preserving omitted-vs-clear semantics.
 * `policy:null` clears the complete policy; top-level fields patch one field.
 */
export async function resolveApiKeyPolicyInput(body, { create = false } = {}) {
  const hasEnvelope = Object.hasOwn(body, "policy");
  const patchFields = POLICY_FIELDS.filter((field) => Object.hasOwn(body, field));
  if (hasEnvelope && patchFields.length > 0) {
    throw new ApiKeyPolicyInputError("Submit either policy or individual policy fields, not both");
  }
  if (hasEnvelope) return { present: true, value: await normalizeManagedPolicy(body.policy) };
  if (patchFields.length === 0) {
    return {
      present: create,
      value: create ? { ...UNRESTRICTED_POLICY, allowedModels: [] } : undefined,
    };
  }

  const patch = {};
  for (const field of patchFields) {
    const normalized = await normalizeManagedPolicy({ [field]: body[field] });
    patch[field] = normalized[field];
  }
  if (create) return { present: true, value: await normalizeManagedPolicy(patch) };
  return { present: true, patch };
}

export function isApiKeyPolicyInputError(error) {
  return error?.code === "INVALID_API_KEY_POLICY";
}
