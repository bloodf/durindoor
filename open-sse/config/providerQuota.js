import { isObject } from "@/shared/utils/typeChecks.js"; /**
 * Authoritative provider-quota endpoints and operational bounds.
 *
 * This module is intentionally side-effect free so offline tests and quota
 * workers never have to import the generated provider registry.
 */

function deepFreeze(value) {
  if (!value || !isObject(value) || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export const PROVIDER_QUOTA_DEFAULTS = deepFreeze({
  timeoutMs: 10_000,
  freshnessMs: 60_000,
  cacheTtlMs: 60_000,
  maxCacheEntries: 512,
  maxResponseBytes: 1024 * 1024
});

const PREFLIGHT_POLICY = deepFreeze({
  google: { gates: [{ aggregate: "all-required", selectors: [{ resource: "requested", dimensionNamespaces: ["requests"] }] }] },
  codex: { gates: [{ choose: "first-present", aggregate: "all-required", selectors: [{ resource: "requested", dimensionNamespaces: ["requests"] }, { resource: "account", dimensionNamespaces: ["requests"] }] }] },
  accountRequests: { gates: [{ aggregate: "all-required", selectors: [{ resource: "account", dimensionNamespaces: ["requests"] }, { resource: "requested", dimensionNamespaces: ["requests"] }] }] },
  github: { gates: [{ aggregate: "all-required", selectors: [{ resource: "account", dimensionKeys: ["requests:chat"] }] }] },
  cursor: { gates: [{ aggregate: "all-required", selectors: [{ resource: "account", dimensionKeys: ["requests:api"] }] }] },
  kiro: { gates: [{ aggregate: "any-sufficient", selectors: [{ resourceKey: "resource:agentic_request", dimensionNamespaces: ["requests"] }] }] },
  glm: { gates: [{ aggregate: "all-required", selectors: [{ resource: "account", dimensionNamespaces: ["tokens"] }, { resourceNamespace: "project", dimensionNamespaces: ["tokens"] }] }] },
  codebuddy: { gates: [{ aggregate: "any-sufficient", selectors: [{ resourceNamespace: "package", dimensionNamespaces: ["credits"] }] }] },
  qoderLegacy: { gates: [{ aggregate: "any-sufficient", selectors: [{ resourceNamespace: "scope", dimensionNamespaces: ["credits"] }] }] },
  balance: { gates: [{ aggregate: "all-required", selectors: [{ resource: "account", dimensionNamespaces: ["balance"] }] }] },
  crof: { gates: [{ choose: "first-present", aggregate: "all-required", selectors: [{ resource: "account", dimensionKeys: ["requests:daily"] }, { resource: "account", dimensionKeys: ["balance:usd"] }] }] },
  deepseek: { gates: [{ aggregate: "any-sufficient", selectors: [{ resourceNamespace: "currency", dimensionKeys: ["balance:available"] }] }] }
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
    preflightPolicy: PREFLIGHT_POLICY.google
  },
  antigravity: {
    adapter: "google",
    mode: "antigravity",
    sourceId: "antigravity:retrieve-user-quota:v1",
    quotaUrl: GOOGLE_QUOTA_URL,
    projectUrl: "https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:loadCodeAssist",
    preflightPolicy: PREFLIGHT_POLICY.google
  },
  agy: {
    adapter: "google",
    mode: "antigravity",
    sourceId: "agy:retrieve-user-quota:v1",
    quotaUrl: GOOGLE_QUOTA_URL,
    projectUrl: "https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:loadCodeAssist",
    preflightPolicy: PREFLIGHT_POLICY.google
  },
  codex: {
    adapter: "codex",
    sourceId: "codex:wham-usage:v1",
    url: "https://chatgpt.com/backend-api/wham/usage",
    // Explicit aliases used by quota preflight. These are deliberately exact:
    // quota families and provider resource names must never be inferred with
    // substring matching from an untrusted passthrough model ID.
    preflightScopes: {
      quotaFamilies: { review: "feature:code-review" },
      models: { "gpt-5.3-codex-spark": "model:codex-spark" }
    },
    runtimeScopes: { cooldown: "model", exhausted: "account" },
    preflightPolicy: PREFLIGHT_POLICY.codex
  },
  claude: {
    adapter: "claude",
    sourceId: "claude:oauth-usage:v1",
    oauthUrl: "https://api.anthropic.com/api/oauth/usage",
    settingsUrl: "https://api.anthropic.com/v1/settings",
    orgUsageUrl: "https://api.anthropic.com/v1/organizations/{org_id}/usage",
    runtimeScopes: { cooldown: "model", exhausted: "account" },
    preflightPolicy: PREFLIGHT_POLICY.accountRequests
  },
  github: {
    adapter: "github",
    sourceId: "github:copilot-user-quota:v1",
    url: "https://api.github.com/copilot_internal/user",
    apiVersion: "2026-06-01",
    editorVersion: "vscode/1.126.0",
    pluginVersion: "copilot-chat/0.54.0",
    userAgent: "GitHubCopilotChat/0.54.0",
    preflightPolicy: PREFLIGHT_POLICY.github
  },
  cursor: {
    adapter: "cursor",
    sourceId: "cursor:dashboard-spending:v1",
    url: "https://cursor.com/api/dashboard/get-current-period-usage",
    origin: "https://cursor.com",
    referer: "https://cursor.com/dashboard/spending",
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/149.0.0.0 Safari/537.36",
    preflightPolicy: PREFLIGHT_POLICY.cursor
  },
  kiro: {
    adapter: "kiro",
    sourceId: "kiro:get-usage-limits:v1",
    runtimeScopes: { cooldown: "model", exhausted: "account" },
    preflightPolicy: PREFLIGHT_POLICY.kiro
  },
  "kimi-coding": {
    adapter: "kimi",
    sourceId: "kimi-coding:coding-usages:v1",
    url: "https://api.kimi.com/coding/v1/usages",
    platform: "omniroute",
    version: "2.1.2",
    runtimeScopes: { cooldown: "model", exhausted: "account" },
    preflightPolicy: PREFLIGHT_POLICY.accountRequests
  },
  "kimi-coding-apikey": {
    adapter: "kimi",
    sourceId: "kimi-coding-apikey:coding-usages:v1",
    url: "https://api.kimi.com/coding/v1/usages",
    platform: "omniroute",
    version: "2.1.2",
    runtimeScopes: { cooldown: "model", exhausted: "account" },
    preflightPolicy: PREFLIGHT_POLICY.accountRequests
  },
  glm: {
    adapter: "glm",
    sourceId: "glm:coding-plan-quota:v1",
    url: "https://api.z.ai/api/monitor/usage/quota/limit",
    runtimeScopes: { cooldown: "model", exhausted: "account" },
    preflightPolicy: PREFLIGHT_POLICY.glm
  },
  "glm-cn": {
    adapter: "glm",
    sourceId: "glm-cn:coding-plan-quota:v1",
    url: "https://open.bigmodel.cn/api/monitor/usage/quota/limit",
    runtimeScopes: { cooldown: "model", exhausted: "account" },
    preflightPolicy: PREFLIGHT_POLICY.glm
  },
  zai: {
    adapter: "glm",
    sourceId: "zai:coding-plan-quota:v1",
    url: "https://api.z.ai/api/monitor/usage/quota/limit",
    runtimeScopes: { cooldown: "model", exhausted: "account" },
    preflightPolicy: PREFLIGHT_POLICY.glm
  },
  glmt: {
    adapter: "glm",
    sourceId: "glmt:coding-plan-quota:v1",
    url: "https://api.z.ai/api/monitor/usage/quota/limit",
    runtimeScopes: { cooldown: "model", exhausted: "account" },
    preflightPolicy: PREFLIGHT_POLICY.glm
  },
  minimax: {
    adapter: "minimax",
    sourceId: "minimax:coding-plan-remains:v1",
    urls: [
    { url: "https://www.minimax.io/v1/token_plan/remains" },
    { url: "https://api.minimax.io/v1/api/openplatform/coding_plan/remains" }],

    runtimeScopes: { cooldown: "model", exhausted: "account" },
    preflightPolicy: PREFLIGHT_POLICY.accountRequests
  },
  "minimax-cn": {
    adapter: "minimax",
    sourceId: "minimax-cn:coding-plan-remains:v1",
    urls: [
    { url: "https://www.minimaxi.com/v1/api/openplatform/coding_plan/remains" },
    { url: "https://api.minimaxi.com/v1/api/openplatform/coding_plan/remains" }],

    runtimeScopes: { cooldown: "model", exhausted: "account" },
    preflightPolicy: PREFLIGHT_POLICY.accountRequests
  },
  "codebuddy-cn": {
    adapter: "codebuddy",
    sourceId: "codebuddy-cn:billing-meter:v1",
    url: "https://copilot.tencent.com/v2/billing/meter/get-user-resource",
    runtimeScopes: { cooldown: "model", exhausted: "account" },
    preflightPolicy: PREFLIGHT_POLICY.codebuddy
  },
  "bailian-coding-plan": {
    adapter: "bailian",
    sourceId: "bailian-coding-plan:console-quota:v1",
    tokenPlanSourceId: "bailian-coding-plan:token-plan-quota:v1",
    tokenPlanHosts: {
      international: "https://bailian-singapore-cs.alibabacloud.com",
      domestic: "https://cs-data.qwencloud.com"
    },
    urls: [
    "https://modelstudio.console.alibabacloud.com/data/api.json?action=zeldaEasy.broadscope-bailian.codingPlan.queryCodingPlanInstanceInfoV2&product=broadscope-bailian&api=queryCodingPlanInstanceInfoV2",
    "https://bailian.console.aliyun.com/data/api.json?action=zeldaEasy.broadscope-bailian.codingPlan.queryCodingPlanInstanceInfoV2&product=broadscope-bailian&api=queryCodingPlanInstanceInfoV2"],

    runtimeScopes: { cooldown: "model", exhausted: "account" },
    preflightPolicy: PREFLIGHT_POLICY.accountRequests
  },
  qoder: {
    adapter: "qoder",
    mode: "pat-status",
    sourceId: "qoder:user-status:v1",
    exchangeUrl: "https://openapi.qoder.sh/api/v1/jobToken/exchange",
    url: "https://openapi.qoder.sh/api/v3/user/status",
    runtimeScopes: { cooldown: "model", exhausted: "account" },
    preflightPolicy: PREFLIGHT_POLICY.accountRequests
  },
  "qoder-cn": {
    adapter: "qoder",
    mode: "legacy-oauth",
    sourceId: "qoder-cn:quota-usage-legacy:v1",
    url: "https://openapi.qoder.com.cn/api/v2/quota/usage",
    runtimeScopes: { cooldown: "model", exhausted: "account" },
    preflightPolicy: PREFLIGHT_POLICY.qoderLegacy
  },
  "vercel-ai-gateway": {
    adapter: "vercel",
    sourceId: "vercel-ai-gateway:credits:v1",
    url: "https://ai-gateway.vercel.sh/v1/credits",
    runtimeScopes: { cooldown: "model", exhausted: "account" },
    preflightPolicy: PREFLIGHT_POLICY.balance
  },
  crof: {
    adapter: "crof",
    sourceId: "crof:usage-api:v1",
    url: "https://crof.ai/usage_api/",
    runtimeScopes: { cooldown: "model", exhausted: "account" },
    preflightPolicy: PREFLIGHT_POLICY.crof
  },
  deepseek: {
    adapter: "deepseek",
    sourceId: "deepseek:balance:v1",
    url: "https://api.deepseek.com/user/balance",
    runtimeScopes: { cooldown: "model", exhausted: "account" },
    preflightPolicy: PREFLIGHT_POLICY.deepseek
  }
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
  "opencode-zen": "speculative-endpoint"
});

export function getProviderQuotaConfig(provider) {
  return PROVIDER_QUOTA_CONFIG[provider] || null;
}