// Seeds for combos, API keys, model aliases and proxy pools, mapped from the
// shared world into the real repository row shapes.
import {
  API_KEYS,
  COMBOS,
  CONNECTIONS,
  DAY_MS,
  HOUR_MS,
  MACHINE_ID,
  MODEL_ALIASES,
  PROVIDER_NODES,
  PROXY_POOLS,
  isoAgo,
  isoAhead,
} from "./world.js";

// Combos (combosRepo.rowToCombo).
export function seedCombos() {
  return COMBOS.map((combo, index) => ({
    id: combo.id,
    name: combo.name,
    kind: combo.kind,
    models: [...combo.models],
    members: combo.models.map((id, position) => ({ id, weight: combo.name === "daily-coder" && position === 0 ? 3 : 1 })),
    invariant: null,
    capabilities: null,
    allowedConnectionIds: combo.name === "vision-stack" ? ["conn-gemini-cli", "conn-antigravity", "conn-anthropic-team"] : [],
    createdAt: isoAgo((90 - index * 20) * DAY_MS),
    updatedAt: isoAgo((3 + index) * DAY_MS),
  }));
}

export function seedAliases() {
  return { ...MODEL_ALIASES };
}

// API-key policies read by src/app/(dashboard)/dashboard/endpoint/apiKeyPolicy.js.
const KEY_EXTRAS = {
  "key-workstation": {
    policy: null,
    providerConnectionIds: [],
    expiresAt: null,
    createdAt: isoAgo(120 * DAY_MS),
  },
  "key-ci": {
    policy: { allowedModels: [], maxTokens: null, maxCostUsd: 25 },
    providerConnectionIds: ["conn-groq", "conn-deepseek", "conn-ollama"],
    expiresAt: isoAhead(60 * DAY_MS),
    createdAt: isoAgo(45 * DAY_MS),
  },
  "key-agents": {
    policy: { allowedModels: ["claude/claude-opus-5", "codex/gpt-6-astra", "gemini-cli/gemini-3.1-pro-preview"], maxTokens: 50_000_000, maxCostUsd: 400 },
    providerConnectionIds: [],
    expiresAt: null,
    createdAt: isoAgo(20 * DAY_MS),
  },
};

export function seedApiKeys() {
  return API_KEYS.map((key) => ({
    id: key.id,
    key: key.key,
    name: key.name,
    machineId: MACHINE_ID,
    isActive: key.isActive,
    allowedCombos: [...key.allowedCombos],
    dailyLimitTokens: key.dailyLimitTokens,
    ...KEY_EXTRAS[key.id],
    usage: {
      totalTokens: key.usage.tokens,
      totalCost: key.usage.cost,
      totalRequests: key.usage.requests,
      updatedAt: isoAgo(7 * 60_000),
    },
  }));
}

/** Policy catalog rows (GET /api/keys/policy-catalog) built from world models. */
export function buildPolicyCatalog() {
  const catalog = new Map();
  for (const connection of CONNECTIONS) {
    for (const model of connection.models || []) {
      const id = `${connection.provider}/${model}`;
      if (catalog.has(id)) continue;
      catalog.set(id, {
        id,
        displayId: `${connection.alias}/${model}`,
        name: model,
        provider: connection.provider,
        kinds: ["llm"],
        capabilities: {},
      });
    }
  }
  const node = PROVIDER_NODES[0];
  catalog.set(`${node.id}/text-embedding-3-large`, {
    id: `${node.id}/text-embedding-3-large`,
    displayId: `${node.prefix}/text-embedding-3-large`,
    name: "text-embedding-3-large",
    provider: node.id,
    kinds: ["embedding"],
    capabilities: {},
  });
  return [...catalog.values()].sort((a, b) => a.id.localeCompare(b.id));
}

// Connections bound to each pool (connection.providerSpecificData.proxyPoolId).
export const POOL_BINDINGS = Object.freeze({ "pool-erebor": 2, "pool-dale": 1 });

export function seedProxyPools() {
  const fromWorld = PROXY_POOLS.map((pool, index) => ({
    ...pool,
    type: "http",
    lastTestedAt: isoAgo((index + 1) * 2 * HOUR_MS),
    lastError: null,
    createdAt: isoAgo((60 - index * 10) * DAY_MS),
    updatedAt: isoAgo((index + 1) * DAY_MS),
  }));
  return [
    ...fromWorld,
    {
      id: "pool-moria",
      name: "Moria relay",
      proxyUrl: "https://moria-relay.balin.workers.dev",
      noProxy: "",
      isActive: false,
      strictProxy: false,
      type: "cloudflare",
      testStatus: "error",
      lastTestedAt: isoAgo(26 * HOUR_MS),
      lastError: "Relay test timed out",
      createdAt: isoAgo(14 * DAY_MS),
      updatedAt: isoAgo(26 * HOUR_MS),
    },
  ];
}

/** Proxy URLs pointing at Moria never answer, everything else does. */
export function isDeadProxy(proxyUrl) {
  return /moria/i.test(String(proxyUrl || ""));
}

export function randomSecret() {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return `sk-dd-${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
