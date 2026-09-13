// Quota snapshots in the exact shape open-sse/services/usage/<provider>.js
// returns, so ProviderLimits' parseQuotaData renders them unchanged.
import { isoAgo, isoAhead, DAY_MS, HOUR_MS, MINUTE_MS } from "../world.js";

function percentWindow(usedPercent, resetInMs, extra = {}) {
  const used = Math.max(0, Math.min(100, usedPercent));
  return { used, total: 100, remaining: 100 - used, resetAt: isoAhead(resetInMs), unlimited: false, ...extra };
}

function claudeWindow(usedPercent, resetInMs) {
  const window = percentWindow(usedPercent, resetInMs);
  return { ...window, remainingPercentage: window.remaining };
}

function fractionWindow(remainingFraction, resetInMs) {
  const total = 1000;
  const remaining = Math.round(total * remainingFraction);
  return { used: total - remaining, total, resetAt: isoAhead(resetInMs), remainingPercentage: remainingFraction * 100, unlimited: false };
}

function codexResetCredits(count) {
  const credits = Array.from({ length: count }, (_, index) => ({
    id: `rlrc_${index + 1}`,
    index,
    status: "available",
    grantedAt: isoAgo((index + 2) * DAY_MS),
    expiresAt: isoAhead((12 + index * 9) * DAY_MS),
    type: "rate_limit_reset",
  }));
  return { availableCount: count, credits };
}

const SNAPSHOTS = {
  "conn-claude-balin": () => ({
    plan: "Claude Code",
    quotas: {
      "session (5h)": claudeWindow(38, 2 * HOUR_MS + 14 * MINUTE_MS),
      "weekly (7d)": claudeWindow(61, 3 * DAY_MS + 5 * HOUR_MS),
      "weekly Opus (7d)": claudeWindow(72, 3 * DAY_MS + 5 * HOUR_MS),
      "weekly Sonnet (7d)": claudeWindow(24, 3 * DAY_MS + 5 * HOUR_MS),
    },
  }),
  "conn-codex-main": (credits) => ({
    plan: "pro",
    limitReached: false,
    reviewLimitReached: false,
    sparkLimitReached: false,
    resetCredits: credits,
    quotas: {
      session: percentWindow(27, 3 * HOUR_MS + 40 * MINUTE_MS, { windowSeconds: 18_000 }),
      weekly: percentWindow(44, 4 * DAY_MS + 2 * HOUR_MS, { windowSeconds: 604_800 }),
      review_session: percentWindow(8, 3 * HOUR_MS + 40 * MINUTE_MS, { windowSeconds: 18_000 }),
    },
  }),
  "conn-codex-backup": (credits) => ({
    plan: "plus",
    limitReached: true,
    reviewLimitReached: false,
    sparkLimitReached: false,
    resetCredits: credits,
    quotas: {
      session: percentWindow(100, 37 * MINUTE_MS, { windowSeconds: 18_000 }),
      weekly: percentWindow(83, 2 * DAY_MS + 9 * HOUR_MS, { windowSeconds: 604_800 }),
    },
  }),
  "conn-copilot": () => ({
    plan: "copilot_pro_plus",
    resetDate: isoAhead(17 * DAY_MS).slice(0, 10),
    quotas: {
      chat: { used: 0, total: 0, unlimited: true, resetAt: isoAhead(17 * DAY_MS) },
      completions: { used: 0, total: 0, unlimited: true, resetAt: isoAhead(17 * DAY_MS) },
      premium_interactions: { used: 912, total: 1500, remaining: 588, unlimited: false, resetAt: isoAhead(17 * DAY_MS) },
    },
  }),
  "conn-gemini-cli": () => ({
    plan: "Standard",
    quotas: {
      "gemini-3.1-pro-preview": fractionWindow(0.58, 14 * HOUR_MS),
      "gemini-3-flash-preview": fractionWindow(0.91, 14 * HOUR_MS),
      "gemini-2.5-flash-lite": fractionWindow(1, 14 * HOUR_MS),
    },
  }),
  "conn-antigravity": () => ({
    plan: "Pro",
    quotas: {
      "gemini-3.8-flash-high": fractionWindow(0.66, 4 * HOUR_MS),
      "gemini-3.1-pro-high": fractionWindow(0.74, 4 * HOUR_MS),
      "claude-opus-4.8-thinking": fractionWindow(0.35, 4 * HOUR_MS),
      "claude-sonnet-4.6": fractionWindow(0.52, 4 * HOUR_MS),
      "gemini-3-pro-image": { ...fractionWindow(0.9, 4 * HOUR_MS), displayName: "Gemini 3 Pro Image" },
    },
  }),
  "conn-kiro": () => ({
    plan: "KIRO PRO",
    quotas: {
      credit: { used: 612.5, total: 1000, remaining: 387.5, resetAt: isoAhead(11 * DAY_MS), unlimited: false },
      credit_freetrial: { used: 50, total: 50, remaining: 0, resetAt: isoAgo(3 * DAY_MS), unlimited: false },
    },
  }),
  "conn-cursor": () => ({
    plan: "Pro",
    quotas: {
      "Included spend": { used: 20, total: 20, remaining: 0, resetAt: isoAhead(9 * DAY_MS), unlimited: false, unit: "usd" },
      "Auto mode": percentWindow(100, 9 * DAY_MS),
      "API usage": percentWindow(100, 9 * DAY_MS),
    },
  }),
  "conn-deepseek": () => ({
    plan: "DeepSeek",
    quotas: {
      "Balance (USD)": { used: 0, total: 48.37, remainingPercentage: 100, resetAt: null, unlimited: true },
    },
  }),
};

export const INITIAL_CODEX_RESET_CREDITS = { "conn-codex-main": 2, "conn-codex-backup": 1 };

/** Quota payload for a connection, or a message the card shows instead. */
export function quotaSnapshot(connection, creditCount = 0) {
  const build = SNAPSHOTS[connection.id];
  if (build) return build(codexResetCredits(creditCount));
  if (connection.authType === "oauth") {
    return {
      plan: connection.provider === "codex" ? "plus" : "Connected",
      quotas: { session: percentWindow(12, 4 * HOUR_MS), weekly: percentWindow(5, 6 * DAY_MS) },
      ...(connection.provider === "codex" ? { limitReached: false, resetCredits: codexResetCredits(creditCount) } : null),
    };
  }
  return { message: "Usage not available for this connection" };
}

export function codexCredits(count) {
  return codexResetCredits(count);
}
