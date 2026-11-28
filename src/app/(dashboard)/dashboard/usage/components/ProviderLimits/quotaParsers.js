import { getModelsByProviderId } from "open-sse/config/providerModels.js";
import { isNumber, isObject } from "../../../../../../shared/utils/typeChecks.js";

/**
 * Build a credits-style quota row (absolute balance, not a request window).
 * `remaining`/`creditCount` hold the raw credit balance; `remainingPercentage`
 * carries the 0-100 display value (getRemainingPercentage prefers it for
 * isCredits rows so a 4,000-credit balance is never rendered as "4,000%").
 */
function buildCreditsQuota(name, remaining, remainingPercentage, extra = {}) {
  return {
    name,
    used: 0,
    total: 0,
    remaining,
    resetAt: null,
    unlimited: false,
    isCredits: true,
    remainingPercentage,
    creditCount: remaining,
    ...extra
  };
}

function buildClaudeExtraUsageQuota(extraUsage) {
  const monthlyLimit = Number(extraUsage?.monthly_limit ?? 0);
  const usedCredits = Number(extraUsage?.used_credits ?? 0);
  const utilization = Number(extraUsage?.utilization ?? 0);
  const remainingPercentage = Number.isFinite(utilization) ?
  Math.max(0, 100 - utilization) :
  undefined;
  const remaining = Number.isFinite(monthlyLimit) ? Math.max(0, monthlyLimit - usedCredits) : 0;

  return buildCreditsQuota("extra_usage", remaining, remainingPercentage ?? 100, {
    used: Number.isFinite(usedCredits) ? usedCredits : 0,
    total: Number.isFinite(monthlyLimit) ? monthlyLimit : 0,
    currency: extraUsage?.currency
  });
}

/**
 * Parse provider-specific quota structures into normalized array
 * @param {string} provider - Provider name (github, antigravity, agy, codex, kiro, claude)
 * @param {Object} data - Raw quota data from provider
 * @returns {Array<Object>} Normalized quota objects with { name, used, total, resetAt }
 */
export function parseQuotaData(provider, data) {
  if (!data || !isObject(data)) return [];

  const normalizedQuotas = [];

  try {
    switch (provider.toLowerCase()) {
      case "github":
        if (data.quotas) {
          Object.entries(data.quotas).forEach(([name, quota]) => {
            normalizedQuotas.push({
              name,
              used: quota.used || 0,
              total: quota.total || 0,
              resetAt: quota.resetAt || null
            });
          });
        }
        break;

      case "agy": // Antigravity CLI shares the Antigravity usage handler (open-sse/services/usage.js)
      case "antigravity":
        if (data.quotas) {
          const entries = Object.entries(data.quotas);
          const hasArgonPool = Boolean(data.quotas.gemini_argon_session || data.quotas.gemini_argon_weekly);
          const geminiModels = entries.filter(([k]) =>
            k.startsWith("gemini-") && !k.includes("image") && (!hasArgonPool || !k.includes("argon"))
          );
          const argonModels = hasArgonPool && !data.quotas.gemini_argon_session
            ? entries.filter(([k]) => k.startsWith("gemini-") && k.includes("argon") && !k.includes("image"))
            : [];
          // Image models are excluded from the Claude family for the same
          // reason as Gemini above: an image row belongs to its own row, and
          // folding it into the family would also duplicate it (the image
          // filter below matches any key containing "image").
          const claudeModels = entries.filter(([k]) => k.startsWith("claude-") && !k.includes("image"));
          const imageModels = entries.filter(([k]) => k.includes("image"));
          const otherModels = entries.filter(([k]) => !k.startsWith("gemini-") && !k.startsWith("claude-") && !k.includes("image"));

          // Port of upstream be3bc764: retrieveUserQuotaSummary now also surfaces a
          // family-level 5h "session" row (gemini_session / claude_gpt_session), which
          // is authoritative for the same sliding window the per-model synthesized row
          // above approximates. Skip the synthesized row when the session row is
          // present, so the dashboard doesn't show two rows for the same window.
          const hasGeminiSession = Boolean(data.quotas.gemini_session);
          const hasClaudeSession = Boolean(data.quotas.claude_gpt_session);

          if (geminiModels.length > 0 && !hasGeminiSession) {
            const rep = geminiModels.reduce((min, cur) =>
              (cur[1].remainingPercentage ?? 100) < (min[1].remainingPercentage ?? 100) ? cur : min
            )[1];
            normalizedQuotas.push({
              name: "Gemini (Flash / Pro)",
              modelKey: "gemini",
              used: rep.used || 0,
              total: rep.total || 0,
              resetAt: rep.resetAt || null,
              remainingPercentage: rep.remainingPercentage,
            });
          }

          if (argonModels.length > 0) {
            const [, quota] = argonModels.reduce((minimum, current) =>
              (current[1].remainingPercentage ?? 100) < (minimum[1].remainingPercentage ?? 100) ? current : minimum
            );
            normalizedQuotas.push({
              name: "Gemini 4 Argon",
              modelKey: "gemini_argon",
              used: quota.used || 0,
              total: quota.total || 0,
              resetAt: quota.resetAt || null,
              remainingPercentage: quota.remainingPercentage,
            });
          }

          if (claudeModels.length > 0 && !hasClaudeSession) {
            const rep = claudeModels.reduce((min, cur) =>
              (cur[1].remainingPercentage ?? 100) < (min[1].remainingPercentage ?? 100) ? cur : min
            )[1];
            normalizedQuotas.push({
              name: "Claude (Sonnet / Opus)",
              modelKey: "claude",
              used: rep.used || 0,
              total: rep.total || 0,
              resetAt: rep.resetAt || null,
              remainingPercentage: rep.remainingPercentage,
            });
          }

          imageModels.forEach(([modelKey, quota]) => {
            normalizedQuotas.push({
              name: quota.displayName || modelKey,
              modelKey,
              used: quota.used || 0,
              total: quota.total || 0,
              resetAt: quota.resetAt || null,
              remainingPercentage: quota.remainingPercentage,
            });
          });

          otherModels.forEach(([modelKey, quota]) => {
            normalizedQuotas.push({
              name: quota.displayName || modelKey,
              modelKey,
              used: quota.used || 0,
              total: quota.total || 0,
              resetAt: quota.resetAt || null,
              remainingPercentage: quota.remainingPercentage
            });
          });
        }
        break;

      case "codex":
        if (data.quotas) {
          Object.entries(data.quotas).forEach(([quotaType, quota]) => {
            normalizedQuotas.push({
              name: quotaType,
              used: quota.used || 0,
              total: quota.total || 0,
              remaining: quota.remaining,
              resetAt: quota.resetAt || null
            });
          });
        }
        break;

      case "kiro":
        if (data.quotas) {
          Object.entries(data.quotas).forEach(([quotaType, quota]) => {
            normalizedQuotas.push({
              name: quotaType,
              used: quota.used || 0,
              total: quota.total || 0,
              resetAt: quota.resetAt || null
            });
          });
        }
        break;

      case "qoder":
      case "qoder-cn":
        // Qoder ships a `user` quota and (optionally) an `organization`
        // quota, both with same shape: {total, used, remaining, unit, resetAt}.
        /**
         * Hide only all-zero organization placeholders; a zero reported total
         * can still carry meaningful usage and is inferred from used + remaining.
         */
        // Don't forward Qoder's `remaining` field: it's an absolute credit
        // count, but getRemainingPercentage / QuotaTable interpret
        // `remaining` as a 0-100 percentage and would render 348 credits
        // as "348%". The percentage is computed from used/total instead.
        if (data.quotas) {
          Object.entries(data.quotas).forEach(([quotaType, quota]) => {
            if (
            quotaType === "organization" && (
            !quota || [quota.total, quota.used, quota.remaining].
            every((value) => (Number(value) || 0) === 0)))
            {
              return;
            }
            normalizedQuotas.push({
              name: quotaType === "user" ? "Personal" : quotaType === "organization" ? "Organization" : quotaType === "addOn" ? "Add-on" : quotaType,
              used: quota.used || 0,
              total: Math.max(0, Number(quota.total) || 0) ||
              (Number(quota.used) || 0) + (Number(quota.remaining) || 0),
              unit: quota.unit,
              resetAt: quota.resetAt || null,
              // Open-ended plans: the service flags Qoder's year-9999 sentinel.
              ...(quota.neverExpires === true ? { neverExpires: true } : null),
              // Add-on credits link to Qoder's own usage page (https only).
              ...(quota.detailUrl ? { detailUrl: quota.detailUrl } : null)
            });
          });
        }
        break;

      case "claude":
        if (data.message) {
          // Handle error message case
          normalizedQuotas.push({
            name: "error",
            used: 0,
            total: 0,
            resetAt: null,
            message: data.message
          });
        } else {
          if (data.quotas) {
            Object.entries(data.quotas).forEach(([name, quota]) => {
              normalizedQuotas.push({
                name,
                used: quota.used || 0,
                total: quota.total || 0,
                resetAt: quota.resetAt || null,
                // Do NOT forward `remaining`: admin/legacy payloads carry an
                // absolute request count there, and getRemainingPercentage
                // prefers `remaining` over the derived percentage — a row like
                // {used:1000,total:5000,remaining:4000} would render "4,000%".
                // Percentage comes from remainingPercentage or used/total.
                remainingPercentage: quota.remainingPercentage
              });
            });
          }
          // #6806: some Claude plans (e.g. "default_raven_enterprise") return no
          // five_hour/seven_day utilization windows at all — only a credit-billing
          // extraUsage block — so quotas can be {} while extraUsage still holds real,
          // actionable usage data. Fold it in as a credits-style row instead of
          // falling back to "No quota data".
          if (data.extraUsage?.is_enabled) {
            normalizedQuotas.push(buildClaudeExtraUsageQuota(data.extraUsage));
          }
        }
        break;

      case "vercel-ai-gateway":
        // Vercel returns currency credit balance, not request quotas.
        // The 'Remaining (USD)' row needs explicit remainingPercentage because
        // its used/total values would otherwise compute the wrong direction
        // (e.g. used=95.5 / total=100 → 4% instead of 96%).
        if (data.quotas) {
          Object.entries(data.quotas).forEach(([name, quota]) => {
            normalizedQuotas.push({
              name,
              used: quota.used || 0,
              total: quota.total || 0,
              resetAt: quota.resetAt || null,
              remainingPercentage: quota.remainingPercentage
            });
          });
        }
        break;

      case "codebuddy-cn":
        // CodeBuddy CN mixes recurring refill packs ("Monthly"/"Weekly"/...)
        // with one-shot bonus packs ("Bonus Pack N"). Forward `recurring`
        // so the UI can show "Expires in" for bonus packs (whose resetAt is
        // a hard expiry, not a refresh) instead of "Reset in".
        if (data.quotas) {
          Object.entries(data.quotas).forEach(([name, quota]) => {
            normalizedQuotas.push({
              name,
              used: quota.used || 0,
              total: quota.total || 0,
              resetAt: quota.resetAt || null,
              recurring: quota.recurring !== false
            });
          });
        }
        break;
      case "grok-cli":
        // Grok CLI / Grok Build (SuperGrok + X Premium+) returns raw.quotas
        // as a { productName: { used, total, remainingPercentage, resetAt } }
        // map. The dashboard rows expect used / total / remainingPercentage
        // (so the percent bar renders); fall back to a derived percent when
        // the upstream doesn't supply it.
        if (data.quotas && isObject(data.quotas) && !Array.isArray(data.quotas)) {
          Object.entries(data.quotas).forEach(([name, quota]) => {
            const used = isNumber(quota?.used) ? quota.used : 0;
            const total = isNumber(quota?.total) ? quota.total : 0;
            const remainingPercentage = isNumber(quota?.remainingPercentage) ?
            quota.remainingPercentage :
            total > 0 ? Math.max(0, Math.min(100, Math.round((total - used) / total * 100))) : 0;
            normalizedQuotas.push({
              name,
              used,
              total,
              remainingPercentage,
              ...(quota?.resetAt ? { resetAt: quota.resetAt } : null)
            });
          });
        }
        break;

      case "kimi":
        // Weekly / Ratelimit from /v1/usages. Prefer remainingPercentage only.
        if (data.quotas) {
          Object.entries(data.quotas).forEach(([name, quota]) => {
            normalizedQuotas.push({
              name,
              used: quota.used || 0,
              total: quota.total || 0,
              resetAt: quota.resetAt || null,
              remainingPercentage: quota.remainingPercentage
            });
          });
        }
        break;

      case "deepseek":
        // Credit balance: DeepSeek's total_balance is a running prepaid balance,
        // not a used/total request window, so QuotaTable renders it as a
        // currency figure instead of a 0/total percentage bar.
        if (data.quotas) {
          Object.entries(data.quotas).forEach(([name, quota]) => {
            normalizedQuotas.push({
              name,
              used: quota.used || 0,
              total: quota.total || 0,
              resetAt: quota.resetAt || null,
              remainingPercentage: quota.remainingPercentage,
              isCreditBalance: quota.isCreditBalance ?? true,
              currency: quota.currency || (name.includes("(") ? name.slice(name.indexOf("(") + 1, name.indexOf(")")) : "USD")
            });
          });
        }
        break;

      case "nan":
        for (const [name, quota] of Object.entries(data.quotas || {})) {
          normalizedQuotas.push({ name, used: quota.used, total: quota.total, resetAt: quota.resetAt || null, unit: quota.unit });
        }
        break;

      case "ollama":
        // Older plans: Session (5h) / Weekly (7d) / Monthly usage from
        // ollama.com/api/usage, as remainingPercentage only. Per-token pricing:
        // rolling "Spent (…)" rows (isSpend) plus an estimated plan pool.
        if (data.quotas) {
          Object.entries(data.quotas).forEach(([name, quota]) => {
            normalizedQuotas.push({
              name,
              used: quota.used || 0,
              total: quota.total || 0,
              resetAt: quota.resetAt || null,
              remainingPercentage: quota.remainingPercentage,
              isSpend: quota.isSpend === true,
              isEstimate: quota.isEstimate === true,
              requestCount: quota.requestCount,
              currency: quota.currency
            });
          });
        }
        break;

      case "opendesign-go":
      case "deeprelay":
        for (const [name, quota] of Object.entries(data.quotas || {})) {
          normalizedQuotas.push({ name: quota.name || name, used: quota.used ?? 0, total: quota.total ?? 0,
            remainingPercentage: quota.remainingPercentage, resetAt: quota.resetAt || null,
            unlimited: quota.unlimited, unit: quota.unit, windowStart: quota.windowStart });
        }
        break;
      default:
        // Generic fallback for unknown providers
        if (data.quotas) {
          Object.entries(data.quotas).forEach(([name, quota]) => {
            normalizedQuotas.push({
              name,
              used: quota.used || 0,
              total: quota.total || 0,
              remaining: quota.remaining !== undefined ? quota.remaining : undefined,
              unlimited: quota.unlimited || false,
              isCreditBalance: quota.isCreditBalance === true,
              currency: quota.currency,
              remainingPercentage: quota.remainingPercentage,
              resetAt: quota.resetAt || null
            });
          });
        }
    }
  } catch (error) {
    console.error(`Error parsing quota data for ${provider}:`, error);
    return [];
  }

  if (provider?.toLowerCase() === "claude") {
    // Claude row names are unique per connection, so key each row by name
    // (via modelKey) instead of array index: the canonical sort below would
    // otherwise move rows and silently invalidate persisted hidden-row keys
    // of the form `<name>::<index>`.
    for (const quota of normalizedQuotas) {
      if (!quota.modelKey && quota.name) quota.modelKey = String(quota.name).trim();
    }
    const CLAUDE_QUOTA_ORDER = {
      "session (5h)": 0,
      "weekly (7d)": 1,
      "weekly fable (7d)": 2,
      "weekly opus (7d)": 3,
      "weekly sonnet (7d)": 4,
    };
    normalizedQuotas.sort((a, b) => (CLAUDE_QUOTA_ORDER[a.name] ?? 99) - (CLAUDE_QUOTA_ORDER[b.name] ?? 99));
    return normalizedQuotas;
  }

  // Sort quotas according to PROVIDER_MODELS order
  const modelOrder = getModelsByProviderId(provider);
  if (modelOrder.length > 0) {
    const orderMap = new Map(modelOrder.map((m, i) => [m.id, i]));

    normalizedQuotas.sort((a, b) => {
      // Use modelKey for antigravity (mapped to family anchor), otherwise use name
      let keyA = a.modelKey || a.name;
      let keyB = b.modelKey || b.name;
      // Fork deviation from upstream f615a83: this catalog has no
      // "gemini-3.8-flash-high"; anchor the grouped Gemini row at the first
      // Gemini text model ("gemini-3.7-flash-high") so it sorts with the family.
      if (keyA === "gemini" || keyA === "gemini_session") keyA = "gemini-3.7-flash-high";
      if (keyA === "claude" || keyA === "claude_gpt_session") keyA = "claude-sonnet-4-6";
      if (keyB === "gemini" || keyB === "gemini_session") keyB = "gemini-3.7-flash-high";
      if (keyB === "claude" || keyB === "claude_gpt_session") keyB = "claude-sonnet-4-6";
      const orderA = orderMap.get(keyA) ?? 999;
      const orderB = orderMap.get(keyB) ?? 999;
      return orderA - orderB;
    });
  }

  return normalizedQuotas;
}
