// Provider connections, compatible nodes and connection groups for the demo.
// World entries are mapped into the stored connectionsRepo row shape
// (rowToConn) plus the extra runtime fields the dashboard reads.
import { CONNECTIONS, PROVIDER_NODES, isoAgo, isoAhead, DAY_MS, HOUR_MS, MINUTE_MS } from "../world.js";

const WORLD_ONLY_FIELDS = ["alias", "models", "usage", "rateLimited", "paused"];

const NO_PROXY = Object.freeze({ connectionProxyEnabled: false, connectionProxyUrl: "", connectionNoProxy: "" });

// Per-connection details that make each row look like a real, lived-in account.
const DETAILS = {
  "conn-claude-balin": {
    createdAgo: 94 * DAY_MS, lastUsedAgo: 2 * MINUTE_MS, consecutiveUseCount: 14,
    expiresAt: isoAhead(5 * HOUR_MS), scope: "user:inference user:profile",
    providerSpecificData: { subscriptionType: "max", rateLimitTier: "default_claude_max_20x" },
  },
  "conn-anthropic-team": {
    createdAgo: 61 * DAY_MS, lastUsedAgo: 26 * MINUTE_MS,
    providerSpecificData: { proxyPoolId: "pool-erebor" },
  },
  "conn-codex-main": {
    createdAgo: 72 * DAY_MS, lastUsedAgo: 4 * MINUTE_MS, consecutiveUseCount: 6,
    expiresAt: isoAhead(8 * DAY_MS),
    providerSpecificData: { chatgptPlanType: "pro", accountId: "acct_8f2c61d0e4", codexFingerprintMode: "session" },
  },
  "conn-codex-backup": {
    createdAgo: 40 * DAY_MS, lastUsedAgo: 6 * MINUTE_MS, lastErrorAgo: 6 * MINUTE_MS,
    expiresAt: isoAhead(3 * DAY_MS), backoffLevel: 2,
    rateLimitedUntil: isoAhead(37 * MINUTE_MS),
    locks: { "modelLock_gpt-5.5": isoAhead(37 * MINUTE_MS) },
    providerSpecificData: { chatgptPlanType: "plus", accountId: "acct_1d77b3a9c2", codexFingerprintMode: "session" },
  },
  "conn-gemini-cli": {
    createdAgo: 55 * DAY_MS, lastUsedAgo: 48 * MINUTE_MS, projectId: "erebor-gemini-4821",
    expiresAt: isoAhead(50 * MINUTE_MS),
    providerSpecificData: { projectId: "erebor-gemini-4821", tier: "standard-tier" },
  },
  "conn-copilot": {
    createdAgo: 120 * DAY_MS, lastUsedAgo: 12 * MINUTE_MS,
    providerSpecificData: { githubLogin: "balin-oakenshield", githubName: "Balin", githubEmail: "balin@erebor.dev", githubUserId: 5821904 },
  },
  "conn-antigravity": {
    createdAgo: 33 * DAY_MS, lastUsedAgo: 3 * HOUR_MS, projectId: "erebor-antigravity-17",
    expiresAt: isoAhead(40 * MINUTE_MS),
    providerSpecificData: { projectId: "erebor-antigravity-17" },
  },
  "conn-kiro": {
    createdAgo: 28 * DAY_MS, lastUsedAgo: 9 * DAY_MS,
    providerSpecificData: { authMethod: "builder-id", region: "us-east-1", profileArn: "arn:aws:codewhisperer:us-east-1:699475941385:profile/EHGA3GRVQMUK" },
  },
  "conn-cursor": {
    createdAgo: 47 * DAY_MS, lastUsedAgo: 2 * HOUR_MS, lastErrorAgo: 2 * HOUR_MS,
    providerSpecificData: { machineId: "demo-machine" },
  },
  "conn-groq": { createdAgo: 88 * DAY_MS, lastUsedAgo: 19 * MINUTE_MS },
  "conn-openrouter": { createdAgo: 101 * DAY_MS, lastUsedAgo: 7 * HOUR_MS },
  "conn-deepseek": { createdAgo: 64 * DAY_MS, lastUsedAgo: 38 * MINUTE_MS },
  "conn-ollama": { createdAgo: 150 * DAY_MS, lastUsedAgo: 55 * MINUTE_MS },
  "conn-ravenhill": { createdAgo: 21 * DAY_MS, lastUsedAgo: 5 * HOUR_MS },
};

// Media / web providers so the media-provider pages have configured accounts.
const EXTRA_CONNECTIONS = [
  { id: "conn-openai-platform", provider: "openai", authType: "apikey", name: "Erebor platform", email: null, priority: 1, isActive: true, testStatus: "active" },
  { id: "conn-elevenlabs", provider: "elevenlabs", authType: "apikey", name: "Narration voices", email: null, priority: 1, isActive: true, testStatus: "active" },
  { id: "conn-tavily", provider: "tavily", authType: "apikey", name: "Tavily research", email: null, priority: 1, isActive: true, testStatus: "active" },
  { id: "conn-firecrawl", provider: "firecrawl", authType: "apikey", name: "Firecrawl crawler", email: null, priority: 1, isActive: true, testStatus: "active" },
  {
    id: "conn-forge-embed", provider: "custom-embedding-forge", authType: "apikey", name: "Forge embeddings", email: null, priority: 1, isActive: true, testStatus: "active",
    providerSpecificData: { prefix: "forge-embed", baseUrl: "http://forge.erebor.internal:8080/v1", nodeName: "Forge embeddings" },
  },
];

const EXTRA_DETAILS = {
  "conn-openai-platform": { createdAgo: 80 * DAY_MS, lastUsedAgo: 3 * HOUR_MS },
  "conn-elevenlabs": { createdAgo: 18 * DAY_MS, lastUsedAgo: 1 * DAY_MS },
  "conn-tavily": { createdAgo: 25 * DAY_MS, lastUsedAgo: 9 * HOUR_MS },
  "conn-firecrawl": { createdAgo: 12 * DAY_MS, lastUsedAgo: 2 * DAY_MS },
  "conn-forge-embed": { createdAgo: 9 * DAY_MS, lastUsedAgo: 14 * HOUR_MS },
};

function withoutWorldFields(entry) {
  return Object.fromEntries(Object.entries(entry).filter(([key]) => !WORLD_ONLY_FIELDS.includes(key)));
}

function buildConnection(entry, details = {}) {
  const { createdAgo = 30 * DAY_MS, lastUsedAgo, lastErrorAgo, locks = {}, providerSpecificData = {}, ...rest } = details;
  const base = withoutWorldFields(entry);
  return {
    ...base,
    ...rest,
    ...locks,
    displayName: base.name,
    globalPriority: null,
    defaultModel: null,
    lastError: base.lastError ?? null,
    lastErrorAt: lastErrorAgo ? isoAgo(lastErrorAgo) : null,
    errorCode: base.errorCode ?? null,
    lastTested: isoAgo(Math.min(createdAgo, 3 * HOUR_MS)),
    lastUsedAt: lastUsedAgo ? isoAgo(lastUsedAgo) : null,
    consecutiveUseCount: rest.consecutiveUseCount ?? 0,
    providerSpecificData: { ...NO_PROXY, ...(base.providerSpecificData || {}), ...providerSpecificData },
    createdAt: isoAgo(createdAgo),
    updatedAt: isoAgo(Math.min(createdAgo, lastUsedAgo || HOUR_MS)),
  };
}

export function seedConnections() {
  return [
    ...CONNECTIONS.map((entry) => buildConnection(entry, DETAILS[entry.id])),
    ...EXTRA_CONNECTIONS.map((entry) => buildConnection(entry, EXTRA_DETAILS[entry.id])),
  ];
}

export function seedProviderNodes() {
  return [
    ...PROVIDER_NODES.map((node) => ({ ...node, createdAt: isoAgo(21 * DAY_MS), updatedAt: isoAgo(4 * DAY_MS) })),
    {
      id: "custom-embedding-forge", type: "custom-embedding", name: "Forge embeddings", prefix: "forge-embed",
      baseUrl: "http://forge.erebor.internal:8080/v1", createdAt: isoAgo(9 * DAY_MS), updatedAt: isoAgo(9 * DAY_MS),
    },
  ];
}

export function seedConnectionGroups() {
  return [
    {
      id: "group-frontline", name: "frontline coders", description: "Premium subscriptions used for day-to-day coding",
      connectionIds: ["conn-claude-balin", "conn-codex-main", "conn-copilot"],
      createdAt: isoAgo(40 * DAY_MS), updatedAt: isoAgo(6 * DAY_MS),
    },
    {
      id: "group-free-tier", name: "free tier", description: "Zero-cost accounts for CI and night agents",
      connectionIds: ["conn-groq", "conn-gemini-cli", "conn-ollama"],
      createdAt: isoAgo(35 * DAY_MS), updatedAt: isoAgo(35 * DAY_MS),
    },
  ];
}

// Fallback model ids for providers without a static registry model list.
export const EXTRA_MODELS = {
  "ollama-local": ["qwen3-coder:30b", "gpt-oss:20b", "llama3.3:70b", "nomic-embed-text"],
  "openai-compatible-ravenhill": ["llama-4-maverick", "qwen3-coder-480b", "mistral-large-3"],
  "custom-embedding-forge": ["bge-m3", "nomic-embed-text-v2"],
  elevenlabs: ["eleven_multilingual_v3", "eleven_flash_v2_5"],
  tavily: ["search", "extract"],
  firecrawl: ["scrape"],
};
