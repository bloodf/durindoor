/**
 * Jev (TypeSafe "System One") routing classifier.
 *
 * Jev is a decision model, not an LLM: send it a `state` plus `questions` and
 * get back typed probabilities. We ask ONE `choice` question — the complexity
 * tier of the coding task — so a combo running the `smart` / `task` strategy can
 * score its members against a judged tier instead of the local keyword and size
 * heuristic in `classifyTask`.
 *
 * Fail-open by contract: on ANY error — no key, timeout, HTTP error, malformed
 * response, unknown tier, low confidence, or an open circuit breaker —
 * `classifyTier()` returns null and the caller keeps the heuristic level. The
 * classifier must never become a single point of failure for routing.
 *
 * The module takes a prepared `state` string rather than a request body so it
 * stays free of any dependency on combo.js (which calls it).
 */

import { isFunction, isNumber, isObject, isString } from "../../src/shared/utils/typeChecks.js";
import {
  JEV_ENDPOINT_PATH,
  JEV_DEFAULT_BASE,
  JEV_DEFAULT_MODEL,
  JEV_TIERS,
  JEV_DEFAULT_CRITERIA,
  JEV_DEFAULT_INSTRUCTIONS,
  JEV_TIMEOUT_MS,
  JEV_BREAKER_COOLDOWN_MS,
  JEV_MIN_CONFIDENCE,
  JEV_INPUT_PRICE_PER_MTOK,
  JEV_OUTPUT_PRICE_PER_MTOK,
} from "../config/jev.js";

const NOOP_LOG = { info() {}, warn() {}, debug() {} };

/**
 * Process-local circuit breaker. Skips Jev calls for a cooldown after a
 * timeout, then lets exactly one request probe recovery. Not coordinated across
 * workers; each process protects its own latency budget.
 * @type {{ openUntil: number, halfOpen: boolean }}
 */
const breaker = { openUntil: 0, halfOpen: false };

/** Test/reset hook: clear breaker state. */
export function resetJevBreaker() {
  breaker.openUntil = 0;
  breaker.halfOpen = false;
}

/** Is the breaker currently open (and not yet probing)? */
function breakerOpen(now) {
  if (breaker.openUntil === 0) return false;
  if (now >= breaker.openUntil) {
    // Cooldown elapsed — allow exactly one probe (half-open).
    if (!breaker.halfOpen) {
      breaker.halfOpen = true;
      return false;
    }
    return true;
  }
  return true;
}

function tripBreaker(now, cooldownMs) {
  breaker.openUntil = now + cooldownMs;
  breaker.halfOpen = false;
}

function closeBreaker() {
  breaker.openUntil = 0;
  breaker.halfOpen = false;
}

/**
 * Classify a prepared request state into a complexity tier via Jev.
 *
 * @param {object} opts
 * @param {string} opts.state - bounded text describing the current ask
 * @param {object} [opts.log] - logger ({info,warn,debug}); optional
 * @param {string} [opts.apiKey] - TypeSafe key; defaults to process.env.TYPESAFE_API_KEY
 * @param {string} [opts.baseUrl] - defaults to process.env.TYPESAFE_API_BASE or JEV_DEFAULT_BASE
 * @param {string} [opts.model] - defaults to JEV_DEFAULT_MODEL
 * @param {object} [opts.criteria] - tier criteria; defaults to JEV_DEFAULT_CRITERIA
 * @param {string} [opts.instructions] - defaults to JEV_DEFAULT_INSTRUCTIONS
 * @param {number} [opts.timeoutMs] - defaults to JEV_TIMEOUT_MS
 * @param {number} [opts.minConfidence] - defaults to JEV_MIN_CONFIDENCE
 * @param {boolean} [opts.breakerEnabled=true]
 * @param {function} [opts.fetchImpl=fetch] - injectable for tests
 * @param {function} [opts.now=Date.now] - injectable for tests
 * @returns {Promise<{tier:string,confidence:number,probabilities:object|null,model:string,spendUsd:number,source:"jev"}|null>}
 *          null on ANY failure / low confidence / open breaker (fail-open).
 */
export async function classifyTier(opts = {}) {
  const {
    state,
    log = NOOP_LOG,
    apiKey = process.env.TYPESAFE_API_KEY,
    baseUrl = (process.env.TYPESAFE_API_BASE || JEV_DEFAULT_BASE).replace(/\/+$/, ""),
    model = JEV_DEFAULT_MODEL,
    criteria = JEV_DEFAULT_CRITERIA,
    instructions = JEV_DEFAULT_INSTRUCTIONS,
    timeoutMs = JEV_TIMEOUT_MS,
    minConfidence = JEV_MIN_CONFIDENCE,
    breakerEnabled = true,
    fetchImpl = (...args) => fetch(...args),
    now = () => Date.now(),
  } = opts;

  const startedAt = now();

  if (!apiKey) {
    log.debug?.("JEV", "no TYPESAFE_API_KEY — skipping classifier (fail-open)");
    return null;
  }

  if (!isString(state) || !state.trim()) {
    log.debug?.("JEV", "empty state — skipping classifier (fail-open)");
    return null;
  }

  if (breakerEnabled && breakerOpen(startedAt)) {
    log.debug?.("JEV", "circuit breaker open — skipping classifier (fail-open)");
    return null;
  }

  const payload = {
    model,
    state,
    questions: { tier: { type: "choice", instructions, criteria } },
  };

  let res;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    res = await fetchImpl(`${baseUrl}${JEV_ENDPOINT_PATH}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (e) {
    const isTimeout = e?.name === "AbortError";
    if (isTimeout && breakerEnabled) tripBreaker(now(), JEV_BREAKER_COOLDOWN_MS);
    log.warn?.("JEV", isTimeout ? "classifier timed out — fail-open" : `classifier fetch error — fail-open: ${e?.message || e}`);
    return null;
  } finally {
    clearTimeout(timer);
  }

  if (!res || res.status !== 200) {
    log.warn?.("JEV", `classifier HTTP ${res?.status} — fail-open`);
    return null;
  }

  let json;
  try {
    json = isFunction(res.json) ? await res.json() : null;
  } catch (e) {
    log.warn?.("JEV", `classifier unparseable response — fail-open: ${e?.message || e}`);
    return null;
  }

  const answer = json?.answers?.tier;
  const tier = answer?.choice;
  const confidence = isNumber(answer?.confidence) ? answer.confidence : null;
  const probabilities = isObject(answer?.probabilities) ? answer.probabilities : null;

  if (!tier || !JEV_TIERS.includes(tier)) {
    log.warn?.("JEV", `unknown tier "${tier}" — fail-open`);
    return null;
  }
  if (confidence === null || confidence < minConfidence) {
    log.info?.("JEV", `low confidence (${confidence}) for tier ${tier} — keeping heuristic level`);
    return null;
  }

  // Successful classification — close a half-open breaker.
  if (breakerEnabled) closeBreaker();

  const usage = json?.usage || {};
  const spendUsd =
    ((usage.input_tokens || 0) / 1e6) * JEV_INPUT_PRICE_PER_MTOK +
    ((usage.output_tokens || 0) / 1e6) * JEV_OUTPUT_PRICE_PER_MTOK;

  log.info?.(
    "JEV",
    `tier=${tier} conf=${confidence.toFixed(3)} in ${now() - startedAt}ms (spend $${spendUsd.toFixed(8)})`
  );

  return {
    tier,
    confidence,
    probabilities,
    model: isString(json?.model) ? json.model : model,
    spendUsd,
    source: "jev",
  };
}
