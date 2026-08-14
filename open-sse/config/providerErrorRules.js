/**
 * Provider-specific error markers that do not fit the shared status rules.
 * `scope` records the upstream intent; fallback locking still owns enforcement.
 */
function buildAgentrouterRules() {
  const quotaStatuses = new Set([400, 403, 429]);
  return [
    {
      id: "agentrouter-user-quota-exhausted",
      match: ({ status, body }) => {
        if (!quotaStatuses.has(status) || !JSON.stringify(body ?? "").includes("额度不足")) return null;
        return { reason: "quota_exhausted", scope: "connection" };
      },
    },
    {
      id: "agentrouter-model-access-denied",
      match: ({ status, body }) => {
        if (status !== 403 || !JSON.stringify(body ?? "").includes("无权访问模型")) return null;
        return { reason: "auth_error", scope: "model", cooldownMs: 6 * 60 * 60 * 1000 };
      },
    },
  ];
}

export const providerRuleRegistry = new Map([
  ["agentrouter", buildAgentrouterRules()],
]);

const FULL_TEXT_RULE_PROVIDERS = new Set(["agentrouter"]);

export function resolveRuleMatchBody(provider, structuredError, errorText) {
  if (provider && FULL_TEXT_RULE_PROVIDERS.has(provider.toLowerCase()) && errorText) return errorText;
  return structuredError ?? null;
}

export function getProviderErrorRuleMatch(provider, status, headers, body) {
  if (!provider) return null;
  const rules = providerRuleRegistry.get(provider.toLowerCase());
  if (!rules) return null;
  const normalizedHeaders = !headers
    ? {}
    : typeof headers.get === "function"
      ? Object.fromEntries(headers.entries())
      : Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  for (const rule of rules) {
    const match = rule.match({ status, headers: normalizedHeaders, body });
    if (match) return match;
  }
  return null;
}
