import { FREE_PROVIDERS, AI_PROVIDERS } from "@/shared/constants/providers";

function isLLMProvider(id) {
  const p = AI_PROVIDERS[id];
  if (!p?.serviceKinds) return true;
  return p.serviceKinds.includes("llm");
}

/**
 * Build the provider list shown in UsageStats topology.
 * Includes one entry per active/connected LLM provider, plus enabled no-auth
 * free providers that have not already been emitted by an active connection.
 * Inactive saved connections for no-auth providers are ignored so the static
 * free provider entry is retained.
 */
export function buildUsageProviders(connections = [], nodes = [], disabledFreeProviders = []) {
  const nodeNameMap = {};
  for (const node of nodes) {
    nodeNameMap[node.id] = node.name;
  }
  const seen = new Set();
  const unique = connections
    .filter((c) => {
      if (c.isActive === false) return false;
      if (!isLLMProvider(c.provider)) return false;
      if (seen.has(c.provider)) return false;
      seen.add(c.provider);
      return true;
    })
    .map((c) => ({
      ...c,
      nodeName: nodeNameMap[c.provider] || null,
    }));

  const noAuthProviders = Object.values(FREE_PROVIDERS)
    .filter(
      (p) =>
        p.noAuth &&
        !seen.has(p.id) &&
        !disabledFreeProviders.includes(p.id) &&
        isLLMProvider(p.id),
    )
    .map((p) => ({ provider: p.id, name: p.name }));

  return [...unique, ...noAuthProviders];
}
