/**
 * Command Code usage — 5-hour and weekly credit windows plus the monthly allowance.
 * Auth: Bearer <apiKey>, against the alpha API behind the CLI's `/usage` view.
 * The API sits behind Cloudflare, which rejects calls without the CLI identity
 * headers, so every request carries the registry transport headers.
 */

import commandcodeProvider from "../../providers/registry/commandcode.js";
import { sanitizeErrorMessage } from "../../utils/error.js";
import { isObject, isString } from "../../../src/shared/utils/typeChecks.js";
import { fetchTextWithTimeout, parseResetTime, toFiniteNumber } from "./shared.js";

const API_BASE = "https://api.commandcode.ai/alpha";
const PLAN_NAME = "Command Code";
const TIMEOUT_MS = 10000;

/** Short plan ids the billing API can report. */
const PLAN_ID_ALIASES = new Map([
["go", "individual-go"],
["go-v1", "individual-go-v1"],
["goat", "individual-goat"],
["pro", "individual-pro"],
["pro-v1", "individual-pro-v1"],
["provider", "individual-provider"],
["max", "individual-max"],
["ultra", "individual-ultra"],
["teams-pro", "team-pro"]]);


/** Fixed monthly credit allowance per canonical plan id. */
const PLAN_CREDIT_CAPS = new Map([
["individual-go", 10],
["individual-goat", 70],
["individual-pro", 30],
["individual-pro-v1", 80],
["individual-provider", 15],
["individual-max", 150],
["individual-ultra", 300],
["team-pro", 40]]);

/** GET one JSON object. Never throws and never returns the upstream error body. */
async function getJson(path, apiKey, proxyOptions) {
  try {
    const { response, text } = await fetchTextWithTimeout(
      `${API_BASE}${path}`,
      {
        method: "GET",
        redirect: "error",
        headers: {
          ...commandcodeProvider.transport.headers,
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json"
        }
      },
      TIMEOUT_MS,
      proxyOptions
    );
    if (!response.ok) return { status: response.status };
    let data = null;
    try {data = JSON.parse(text);} catch {/* reported below */}
    return isObject(data) && data !== null ?
    { status: response.status, data } :
    { status: response.status, failure: "response was not JSON" };
  } catch (error) {
    return { status: 0, failure: `request failed: ${sanitizeErrorMessage(error?.message || error)}` };
  }
}

/** Credit amounts are fractional USD; two decimals is what the CLI shows. */
const roundCredits = (value) => Math.round(value * 100) / 100;

/** `remaining` is left unset on purpose: the quota table reads it as a percentage. */
function creditQuota(used, total, resetAt) {
  return {
    used: roundCredits(used),
    total: roundCredits(total),
    remainingPercentage: Math.max(0, Math.min(100, Math.round((total - used) / total * 100))),
    resetAt: parseResetTime(resetAt)
  };
}

function windowQuota(window) {
  const cap = toFiniteNumber(window?.cap, 0);
  if (!(cap > 0)) return null;
  return creditQuota(Math.max(0, toFiniteNumber(window.used, 0)), cap, window.resetAt);
}

/**
 * `monthlyCredits` is what is LEFT of the plan allowance. A known plan cap sizes
 * the row (period spend can lag the balance); otherwise allowance = left + spend.
 */
function monthlyQuota(credits, cap, summary, resetAt) {
  const balance = toFiniteNumber(credits?.monthlyCredits, null);
  if (balance === null) return null;
  const left = Math.max(0, balance);
  if (cap) return creditQuota(Math.max(0, cap - left), Math.max(cap, left), resetAt);
  const spent = toFiniteNumber(summary?.totalCost, null);
  if (spent === null) return null;
  const used = Math.max(0, spent);
  return left + used > 0 ? creditQuota(used, left + used, resetAt) : null;
}

const message = (text) => ({ plan: PLAN_NAME, message: text });
const AUTH_FAILED = "Command Code authentication failed. Check the API key.";

function creditsFailure({ status, failure }) {
  if (status === 401 || status === 403) return "Command Code rejected the request. Check the API key.";
  if (failure) return `Command Code credits ${failure}`;
  return `Command Code credits API error (${status})`;
}

/**
 * @param {string|null|undefined} apiKey
 * @param {object|null} proxyOptions
 */
export async function getCommandCodeUsage(apiKey = null, proxyOptions = null) {
  const key = isString(apiKey) ? apiKey.trim() : "";
  if (!key) return { message: "Command Code API key not available. Add a key to view usage." };

  // whoami only supplies the optional organization scope.
  const whoami = await getJson("/whoami", key, proxyOptions);
  if (whoami.status === 401) return message(AUTH_FAILED);
  const orgId = whoami.data?.org?.id;
  const scope = orgId ? `?orgId=${encodeURIComponent(orgId)}` : "";

  const credits = await getJson(`/billing/credits${scope}`, key, proxyOptions);
  if (!credits.data) return message(creditsFailure(credits));

  // Plan and billing period are best-effort and must not hide the windows.
  const subscription = await getJson(`/billing/subscriptions${scope}`, key, proxyOptions);
  if (subscription.status === 401) return message(AUTH_FAILED);
  const period = subscription.data?.data ?? subscription.data;
  const planId = PLAN_ID_ALIASES.get(period?.planId) ?? period?.planId;
  const cap = PLAN_CREDIT_CAPS.get(planId);
  const summary = cap ? null : await getJson(`/usage/summary${scope}`, key, proxyOptions);
  const windowLimits = credits.data.windowLimits;
  const quotas = Object.fromEntries([
    ["5-hour", windowQuota(windowLimits?.fiveHour)],
    ["Weekly", windowQuota(windowLimits?.weekly)],
    ["Monthly credits", monthlyQuota(credits.data.credits, cap, summary?.data, period?.currentPeriodEnd)]
  ].filter(([, quota]) => quota));
  if (Object.keys(quotas).length === 0) return message("Command Code connected. No credit or window data returned.");

  const planLabel = planId ? `${PLAN_NAME} (${planId})` : PLAN_NAME;
  return {
    plan: windowLimits?.limited === true && windowLimits.exceeded ? `${planLabel} — limit exceeded` : planLabel,
    quotas
  };
}
