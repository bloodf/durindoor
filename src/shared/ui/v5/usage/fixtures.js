/** Production-shaped, isolated Storybook data. No credentials or live provider requests. */
const timestamp = "2026-10-08T12:00:00.000Z";
const modelKey = "gpt-4o (openai)";
const accountId = "usage-review-openai";
const bucket = {
  requests: 12, promptTokens: 4800, completionTokens: 1200, cachedTokens: 1800,
  cacheCreationTokens: 200, reasoningTokens: 100, cost: 0.38,
  inputCost: 0.15, cachedCost: 0.03, cacheCreationCost: 0.02,
  outputCost: 0.14, reasoningCost: 0.02, unsplitCost: 0.02,
  rawModel: "gpt-4o", provider: "OpenAI", rawProvider: "openai", lastUsed: timestamp,
};

export const usageStats = {
  totalRequests: 12, totalPromptTokens: 4800, totalCompletionTokens: 1200,
  totalCachedTokens: 1800, totalCacheCreationTokens: 200, totalReasoningTokens: 100,
  totalCost: 0.38, timedRequests: 12, avgTps: 42, avgDurationMs: 1500, avgTtftMs: 120,
  byModel: { [modelKey]: bucket },
  byProvider: { openai: bucket },
  byAccount: { "gpt-4o (openai - Review account)": { ...bucket, connectionId: accountId, accountName: "Review account" } },
  byApiKey: { "gpt-4o (Review development key)": { ...bucket, keyName: "Review development key" } },
  byEndpoint: { "gpt-4o (/v1/chat/completions)": { ...bucket, endpoint: "/v1/chat/completions" } },
  pending: { byModel: { [modelKey]: 2 }, byAccount: { [accountId]: { [modelKey]: 2 } }, byKey: {} },
  activeRequests: [{ provider: "openai", model: "gpt-4o", count: 2, keys: [{ name: "Review development key", count: 2 }] }],
  activeSessions: [{ requestId: "usage-review-live", clientId: "review-client", provider: "openai", model: "gpt-4o", status: "active", promptTokens: 800, completionTokens: 120 }],
  recentRequests: [{ timestamp, model: "gpt-4o", provider: "openai", promptTokens: 400, completionTokens: 100, status: "success" }],
  errorProvider: "", last10Minutes: [],
};

/** Empty statistics keep the same payload contract as the production usage repository. */
export const emptyUsageStats = {
  totalRequests: 0, totalPromptTokens: 0, totalCompletionTokens: 0, totalCachedTokens: 0,
  totalCacheCreationTokens: 0, totalReasoningTokens: 0, totalCost: 0, timedRequests: 0,
  avgTps: 0, avgDurationMs: 0, avgTtftMs: 0,
  byModel: {}, byProvider: {}, byAccount: {}, byApiKey: {}, byEndpoint: {},
  pending: { byModel: {}, byAccount: {}, byKey: {} },
  activeRequests: [], activeSessions: [], recentRequests: [], errorProvider: "", last10Minutes: [],
};

export const usageFixture = {
  scenario: "default", pathname: "/dashboard/usage", params: {},
  routes: {
    "GET /api/providers": { body: { connections: [{ id: accountId, provider: "openai", name: "Review account", isActive: true, authType: "apikey" }] } },
    "GET /api/provider-nodes": { body: { nodes: [] } },
    "GET /api/settings": { body: { enableObservability: true, disabledFreeProviders: [] } },
    "GET /api/usage/stats": (request) => ({ body: new URL(request.url).searchParams.has("startDate") ? { ...usageStats, totalRequests: 27 } : usageStats }),
    "GET /api/usage/stream": { events: [usageStats] },
    "GET /api/usage/chart": { body: [{ date: "2026-10-07", label: "Oct 7", tokens: 2400, cost: 0.15 }, { date: "2026-10-08", label: "Oct 8", tokens: 3600, cost: 0.23 }] },
    "GET /api/usage/combos": { body: { boundary: "Recorded combo attribution in the selected range", rows: [{ comboId: "review-combo", comboName: "Review coding fallback", connectionId: accountId, requests: 8, promptTokens: 3200, completionTokens: 800, cost: 0.25 }], unattributed: { requests: 4, promptTokens: 1600, completionTokens: 400, cost: 0.13 } } },
    "GET /api/keys": { body: { keys: [{ id: "usage-review-key", name: "Review development key", isActive: true }] } },
    "GET /api/keys/usage": { body: { usage: { "usage-review-key": { rpm: { used: 2, limit: 30 }, tpm: { used: 1800, limit: 10000 }, limits: [{ field: "dailyTokenLimit", label: "Tokens / day", used: 6000, limit: 100000, resetAt: "2026-10-09T00:00:00.000Z" }] } } } },
    "GET /api/usage/providers": { body: { providers: [{ id: "openai", name: "OpenAI" }] } },
    "GET /api/usage/request-details": { body: { details: [{ id: "usage-review-detail", timestamp, provider: "openai", model: "gpt-4o", status: "success", tokens: { prompt_tokens: 400, completion_tokens: 100, cached_tokens: 150 }, latency: { total: 1500, ttft: 120 }, request: { redacted: true, format: "json", bytes: 128 }, response: { redacted: true, format: "json", bytes: 256 } }], pagination: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 } } },
    "GET /api/usage/request-logs": { body: ["2026-10-08 12:00:00 | gpt-4o | openai | Review account | 400 | 100 | OK"] },
    "POST /api/usage/reset": { body: { success: true } },
  },
};
