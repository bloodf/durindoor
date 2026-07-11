/**
 * Authoritative provider-quota endpoints and operational bounds.
 *
 * This module is intentionally side-effect free so offline tests and quota
 * workers never have to import the generated provider registry.
 */

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export const PROVIDER_QUOTA_DEFAULTS = deepFreeze({
  timeoutMs: 10_000,
  freshnessMs: 60_000,
  cacheTtlMs: 60_000,
  maxCacheEntries: 512,
  maxResponseBytes: 1024 * 1024,
});

const GOOGLE_QUOTA_URL = "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota";
const GOOGLE_PROJECT_URL = "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist";

export const PROVIDER_QUOTA_CONFIG = deepFreeze({
  "gemini-cli": {
    adapter: "google",
    mode: "gemini-cli",
    sourceId: "gemini-cli:retrieve-user-quota:v1",
    quotaUrl: GOOGLE_QUOTA_URL,
    projectUrl: GOOGLE_PROJECT_URL,
  },
  antigravity: {
    adapter: "google",
    mode: "antigravity",
    sourceId: "antigravity:retrieve-user-quota:v1",
    quotaUrl: GOOGLE_QUOTA_URL,
    projectUrl: "https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:loadCodeAssist",
  },
  agy: {
    adapter: "google",
    mode: "antigravity",
    sourceId: "agy:retrieve-user-quota:v1",
    quotaUrl: GOOGLE_QUOTA_URL,
    projectUrl: "https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:loadCodeAssist",
  },
  codex: {
    adapter: "codex",
    sourceId: "codex:wham-usage:v1",
    url: "https://chatgpt.com/backend-api/wham/usage",
  },
  claude: {
    adapter: "claude",
    sourceId: "claude:oauth-usage:v1",
    oauthUrl: "https://api.anthropic.com/api/oauth/usage",
    settingsUrl: "https://api.anthropic.com/v1/settings",
    orgUsageUrl: "https://api.anthropic.com/v1/organizations/{org_id}/usage",
  },
  github: {
    adapter: "github",
    sourceId: "github:copilot-user-quota:v1",
    url: "https://api.github.com/copilot_internal/user",
    apiVersion: "2026-06-01",
    editorVersion: "vscode/1.126.0",
    pluginVersion: "copilot-chat/0.54.0",
    userAgent: "GitHubCopilotChat/0.54.0",
  },
  cursor: {
    adapter: "cursor",
    sourceId: "cursor:dashboard-spending:v1",
    url: "https://cursor.com/api/dashboard/get-current-period-usage",
    origin: "https://cursor.com",
    referer: "https://cursor.com/dashboard/spending",
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/149.0.0.0 Safari/537.36",
  },
  kiro: {
    adapter: "kiro",
    sourceId: "kiro:get-usage-limits:v1",
  },
  "kimi-coding": {
    adapter: "kimi",
    sourceId: "kimi-coding:coding-usages:v1",
    url: "https://api.kimi.com/coding/v1/usages",
    platform: "omniroute",
    version: "2.1.2",
  },
  "kimi-coding-apikey": {
    adapter: "kimi",
    sourceId: "kimi-coding-apikey:coding-usages:v1",
    url: "https://api.kimi.com/coding/v1/usages",
    platform: "omniroute",
    version: "2.1.2",
  },
  glm: {
    adapter: "glm",
    sourceId: "glm:coding-plan-quota:v1",
    url: "https://api.z.ai/api/monitor/usage/quota/limit",
  },
  "glm-cn": {
    adapter: "glm",
    sourceId: "glm-cn:coding-plan-quota:v1",
    url: "https://open.bigmodel.cn/api/monitor/usage/quota/limit",
  },
  zai: {
    adapter: "glm",
    sourceId: "zai:coding-plan-quota:v1",
    url: "https://api.z.ai/api/monitor/usage/quota/limit",
  },
  glmt: {
    adapter: "glm",
    sourceId: "glmt:coding-plan-quota:v1",
    url: "https://api.z.ai/api/monitor/usage/quota/limit",
  },
  minimax: {
    adapter: "minimax",
    sourceId: "minimax:coding-plan-remains:v1",
    urls: [
      { url: "https://www.minimax.io/v1/token_plan/remains" },
      { url: "https://api.minimax.io/v1/api/openplatform/coding_plan/remains" },
    ],
  },
  "minimax-cn": {
    adapter: "minimax",
    sourceId: "minimax-cn:coding-plan-remains:v1",
    urls: [
      { url: "https://www.minimaxi.com/v1/api/openplatform/coding_plan/remains" },
      { url: "https://api.minimaxi.com/v1/api/openplatform/coding_plan/remains" },
    ],
  },
  "codebuddy-cn": {
    adapter: "codebuddy",
    sourceId: "codebuddy-cn:billing-meter:v1",
    url: "https://copilot.tencent.com/v2/billing/meter/get-user-resource",
  },
  "bailian-coding-plan": {
    adapter: "bailian",
    sourceId: "bailian-coding-plan:console-quota:v1",
    urls: [
      "https://modelstudio.console.alibabacloud.com/data/api.json?action=zeldaEasy.broadscope-bailian.codingPlan.queryCodingPlanInstanceInfoV2&product=broadscope-bailian&api=queryCodingPlanInstanceInfoV2",
      "https://bailian.console.aliyun.com/data/api.json?action=zeldaEasy.broadscope-bailian.codingPlan.queryCodingPlanInstanceInfoV2&product=broadscope-bailian&api=queryCodingPlanInstanceInfoV2",
    ],
  },
  qoder: {
    adapter: "qoder",
    mode: "pat-status",
    sourceId: "qoder:user-status:v1",
    exchangeUrl: "https://openapi.qoder.sh/api/v1/jobToken/exchange",
    url: "https://openapi.qoder.sh/api/v3/user/status",
  },
  "qoder-cn": {
    adapter: "qoder",
    mode: "legacy-oauth",
    sourceId: "qoder-cn:quota-usage-legacy:v1",
    url: "https://openapi.qoder.com.cn/api/v2/quota/usage",
  },
  "vercel-ai-gateway": {
    adapter: "vercel",
    sourceId: "vercel-ai-gateway:credits:v1",
    url: "https://ai-gateway.vercel.sh/v1/credits",
  },
  crof: {
    adapter: "crof",
    sourceId: "crof:usage-api:v1",
    url: "https://crof.ai/usage_api/",
  },
  deepseek: {
    adapter: "deepseek",
    sourceId: "deepseek:balance:v1",
    url: "https://api.deepseek.com/user/balance",
  },
});

export const PROVIDER_QUOTA_UNSUPPORTED = deepFreeze({
  gemini: "api-key-has-no-account-quota-api",
  qwen: "local-or-message-only",
  iflow: "local-or-message-only",
  xai: "local-history-only",
  "xiaomi-mimo": "no-stable-quota-api",
  "grok-web": "no-stable-quota-api",
  ollama: "no-stable-quota-api",
  "ollama-cloud": "no-stable-quota-api",
  vertex: "billing-not-provider-quota",
  "vertex-partner": "billing-not-provider-quota",
  nanogpt: "provider-not-present",
  "amazon-q": "represented-by-kiro",
  opencode: "speculative-endpoint",
  "opencode-go": "speculative-or-scraped-endpoint",
  "opencode-zen": "speculative-endpoint",
});

export function getProviderQuotaConfig(provider) {
  return PROVIDER_QUOTA_CONFIG[provider] || null;
}
