import { getProviderQuotaConfig } from "../../../config/providerQuota.js";
import { fetchGoogleQuota } from "./google.js";
import { fetchCodexQuota } from "./codex.js";
import { fetchClaudeQuota } from "./claude.js";
import { fetchGitHubQuota } from "./github.js";
import { fetchCursorQuota } from "./cursor.js";
import { fetchKiroQuota, isKiroQuotaConnectionEligible } from "./kiro.js";
import {
  fetchBailianQuota,
  fetchCodeBuddyQuota,
  fetchGlmQuota,
  fetchKimiQuota,
  fetchMiniMaxQuota,
  fetchQoderQuota,
} from "./codingPlans.js";
import {
  fetchCrofQuota,
  fetchDeepSeekQuota,
  fetchVercelQuota,
} from "./balances.js";

export const PROVIDER_QUOTA_ADAPTERS = Object.freeze({
  google: fetchGoogleQuota,
  codex: fetchCodexQuota,
  claude: fetchClaudeQuota,
  github: fetchGitHubQuota,
  cursor: fetchCursorQuota,
  kiro: fetchKiroQuota,
  kimi: fetchKimiQuota,
  glm: fetchGlmQuota,
  minimax: fetchMiniMaxQuota,
  codebuddy: fetchCodeBuddyQuota,
  bailian: fetchBailianQuota,
  qoder: fetchQoderQuota,
  vercel: fetchVercelQuota,
  crof: fetchCrofQuota,
  deepseek: fetchDeepSeekQuota,
});

const PROVIDER_QUOTA_CONNECTION_ELIGIBILITY = Object.freeze({
  kiro: isKiroQuotaConnectionEligible,
});

export function getProviderQuotaAdapter(provider) {
  const config = getProviderQuotaConfig(provider);
  const fetchQuota = config ? PROVIDER_QUOTA_ADAPTERS[config.adapter] : null;
  if (!config || !fetchQuota) return null;
  const isConnectionEligible = PROVIDER_QUOTA_CONNECTION_ELIGIBILITY[config.adapter];
  return {
    config,
    fetchQuota,
    ...(isConnectionEligible ? { isConnectionEligible } : {}),
  };
}
