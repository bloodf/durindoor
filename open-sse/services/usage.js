/**
 * Usage Fetcher - Get usage data from provider APIs
 */

import { getGitHubUsage } from "./usage/github.js";
import { getGeminiUsage, getAntigravityUsage } from "./usage/google.js";
import { getClaudeUsage } from "./usage/claude.js";
import { getCodexUsage, consumeCodexRateLimitResetCredit, getCodexRateLimitResetCredits } from "./usage/codex.js";

export { consumeCodexRateLimitResetCredit, getCodexRateLimitResetCredits };
import { getKiroUsage } from "./usage/kiro.js";
import { getMiniMaxUsage } from "./usage/minimax.js";
import { getCodeBuddyCnUsage } from "./usage/codebuddy-cn.js";
import { getCursorUsage } from "./usage/cursor.js";
import { getKimiUsage } from "./usage/kimi.js";
import { getDeepseekUsage } from "./usage/deepseek.js";
import { getOpenCodeGoUsage } from "./usage/opencode-go.js";
import { getBailianCodingPlanUsage } from "./usage/bailian.js";
import {
  getQwenUsage,
  getIflowUsage,
  getOllamaUsage,
  getGlmUsage,
  getVercelAiGatewayUsage,
  getQoderUsage,
  getXaiUsage,
  getGrokWebUsage,
} from "./usage/misc.js";
import { getGrokCliUsage } from "./usage/grok-cli.js";

/**
 * Get usage data for a provider connection
 * @param {Object} connection - Provider connection with accessToken
 * @returns {Object} Usage data with quotas
 */
// provider → usage handler (ctx carries every arg each handler needs)
const USAGE_HANDLERS = {
  github: (c) => getGitHubUsage(c.accessToken, c.providerSpecificData, c.proxyOptions),
  "gemini-cli": (c) => getGeminiUsage(c.accessToken, c.providerDataWithProjectId, c.proxyOptions),
  antigravity: (c) => getAntigravityUsage(c.accessToken, c.providerDataWithProjectId, c.proxyOptions),
  agy: (c) => getAntigravityUsage(c.accessToken, c.providerDataWithProjectId, c.proxyOptions),
  claude: (c) => getClaudeUsage(c.accessToken ?? c.apiKey, c.proxyOptions, c.authType, { force: c.force }),
  codex: (c) => getCodexUsage(c.accessToken, c.providerSpecificData, c.proxyOptions, c.idToken),
  kiro: (c) => getKiroUsage(c.accessToken, c.providerSpecificData, c.proxyOptions),
  qoder: (c) => getQoderUsage(c.accessToken, c.proxyOptions),
  qwen: (c) => getQwenUsage(c.accessToken, c.providerSpecificData),
  "bailian-coding-plan": (c) => getBailianCodingPlanUsage(c.connection, c.proxyOptions),
  iflow: (c) => getIflowUsage(c.accessToken),
  ollama: (c) => getOllamaUsage(c.apiKey, c.providerSpecificData, c.proxyOptions),
  glm: (c) => getGlmUsage(c.apiKey, c.provider, c.proxyOptions),
  "glm-cn": (c) => getGlmUsage(c.apiKey, c.provider, c.proxyOptions),
  minimax: (c) => getMiniMaxUsage(c.apiKey, c.provider, c.proxyOptions),
  "minimax-cn": (c) => getMiniMaxUsage(c.apiKey, c.provider, c.proxyOptions),
  "vercel-ai-gateway": (c) => getVercelAiGatewayUsage(c.apiKey, c.proxyOptions),
  "codebuddy-cn": (c) => getCodeBuddyCnUsage(c.accessToken, c.apiKey, c.providerSpecificData, c.proxyOptions),
  cursor: (c) => getCursorUsage(c.accessToken, c.providerSpecificData, c.proxyOptions),
  xai: (c) => getXaiUsage(c.connectionId),
  "grok-web": () => getGrokWebUsage(),
  "grok-cli": (c) => getGrokCliUsage(c.accessToken, c.providerSpecificData, c.proxyOptions),
  kimi: (c) => getKimiUsage(c.accessToken, c.apiKey, c.proxyOptions, c.providerSpecificData),
  deepseek: (c) => getDeepseekUsage(c.apiKey, c.proxyOptions),
  "opencode-go": (c) => getOpenCodeGoUsage(c.apiKey, c.proxyOptions),
};

export async function getUsageForProvider(connection, proxyOptions = null, options = {}) {
  const { provider, accessToken, apiKey, authType = "oauth", providerSpecificData, projectId, idToken, id: connectionId } = connection;
  const providerDataWithProjectId = {
    ...(providerSpecificData || {}),
    ...(projectId ? { projectId } : {}),
  };

  const handler = USAGE_HANDLERS[provider];
  if (!handler) return { message: `Usage API not implemented for ${provider}` };
  return await handler({ connection, provider, accessToken, apiKey, authType, providerSpecificData, providerDataWithProjectId, proxyOptions, connectionId, idToken, force: options.force === true });
}
