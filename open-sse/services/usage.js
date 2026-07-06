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

// better-sqlite3 is optional, lazy-loaded inside getXaiUsageFromHistory.
// DATA_FILE is intentionally NOT imported statically: it is a top-level
// `export const` resolved once at module load, so it would freeze against
// whatever DATA_DIR was at import time and never see a later DATA_DIR change
// (e.g. tests setting process.env.DATA_DIR per-case). Resolve it lazily.
import path from "node:path";
import { getDataDir } from "@/lib/dataDir.js";

import {
  getQwenUsage,
  getIflowUsage,
  getOllamaUsage,
  getGlmUsage,
  getVercelAiGatewayUsage,
  getQoderUsage,
} from "./usage/misc.js";

/**
 * xAI (Grok) has no public usage/quotas API, so derive totals from the
 * local `usageHistory` table seeded by the per-request accounting path.
 * Per-model `used` plus an aggregate `Total tokens (30d)` and
 * `Total spend (30d)` are emitted (last-30-days cutoff). No rows ->
 * graceful "No requests recorded." message.
 */
async function getXaiUsageFromHistory(connection) {
  const dbPath = path.join(getDataDir(), "db", "data.sqlite");
  let db;
  try {
    const { default: Database } = await import("better-sqlite3");
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
  } catch {
    return { message: "No requests recorded.", quotas: {} };
  }
  try {
    const connId = connection && connection.id ? connection.id : null;
    const cutoff = new Date(Date.now() - 30 * 86400 * 1000).toISOString();
    const params = { cutoff };
    const conditions = ["provider = 'xai'", "timestamp >= @cutoff"];
    if (connId) {
      conditions.push("connectionId = @connId");
      params.connId = connId;
    }
    const whereSql = conditions.join(" AND ");
    const perModel = db
      .prepare(
        `SELECT model,
                COALESCE(SUM(promptTokens), 0) + COALESCE(SUM(completionTokens), 0) AS used_tokens,
                COALESCE(SUM(cost), 0) AS used_spend
         FROM usageHistory
         WHERE ${whereSql}
         GROUP BY model`
      )
      .all(params);
    if (!perModel.length) {
      return { message: "No requests recorded.", quotas: {} };
    }
    const quotas = {};
    let totalTokens = 0;
    let totalSpend = 0;
    for (const row of perModel) {
      const usedTokens = Number(row.used_tokens) || 0;
      quotas[`${row.model} (30d)`] = { used: usedTokens };
      totalTokens += usedTokens;
      totalSpend += Number(row.used_spend);
    }
    quotas["Total tokens (30d)"] = { used: totalTokens };
    quotas["Total spend (30d)"] = { used: totalSpend };
    return { plan: "xAI / Grok Build", quotas };
  } finally {
    try { db.close(); } catch { /* ignore */ }
  }
}

/**
 * Get usage data for a provider connection
 * @param {Object} connection - Provider connection with accessToken
 * @returns {Object} Usage data with quotas
 */
// provider → usage handler (ctx carries every arg each handler needs)
const USAGE_HANDLERS = {
  github: (c) => getGitHubUsage(c.accessToken, c.providerSpecificData, c.proxyOptions),
  "gemini-cli": (c) => getGeminiUsage(c.accessToken, c.providerDataWithProjectId, c.proxyOptions),
  antigravity: (c) => getAntigravityUsage(c.accessToken, c.providerSpecificData, c.proxyOptions),
  claude: (c) => getClaudeUsage(c.accessToken, c.proxyOptions),
  codex: (c) => getCodexUsage(c.accessToken, c.proxyOptions),
  kiro: (c) => getKiroUsage(c.accessToken, c.providerSpecificData, c.proxyOptions),
  qoder: (c) => getQoderUsage(c.accessToken, c.proxyOptions),
  qwen: (c) => getQwenUsage(c.accessToken, c.providerSpecificData),
  iflow: (c) => getIflowUsage(c.accessToken),
  ollama: (c) => getOllamaUsage(c.accessToken),
  glm: (c) => getGlmUsage(c.apiKey, c.provider, c.proxyOptions),
  "glm-cn": (c) => getGlmUsage(c.apiKey, c.provider, c.proxyOptions),
  minimax: (c) => getMiniMaxUsage(c.apiKey, c.provider, c.proxyOptions),
  "minimax-cn": (c) => getMiniMaxUsage(c.apiKey, c.provider, c.proxyOptions),
  "vercel-ai-gateway": (c) => getVercelAiGatewayUsage(c.apiKey, c.proxyOptions),
  "codebuddy-cn": (c) => getCodeBuddyCnUsage(c.accessToken, c.apiKey, c.providerSpecificData, c.proxyOptions),
  cursor: (c) => getCursorUsage(c.accessToken, c.providerSpecificData, c.proxyOptions),
  xai: (c) => getXaiUsageFromHistory(c),
};

export async function getUsageForProvider(connection, proxyOptions = null) {
  const { id, provider, accessToken, apiKey, providerSpecificData, projectId } = connection;
  const providerDataWithProjectId = {
    ...(providerSpecificData || {}),
    ...(projectId ? { projectId } : {}),
  };

  const handler = USAGE_HANDLERS[provider];
  if (!handler) return { message: `Usage API not implemented for ${provider}` };
  return await handler({ id, provider, accessToken, apiKey, providerSpecificData, providerDataWithProjectId, proxyOptions });
}
