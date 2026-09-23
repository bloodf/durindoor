// "Fake success" 2xx body classifier (ported from OmniRoute #13461 / #13910).
//
// Some free/web-session providers (reported upstream: Pollinations,
// Perplexity web via cookie session) answer a genuine failure — expired
// session, exhausted free-tier credits — with HTTP 200 and a structurally
// normal completion whose assistant message is just the provider's own error
// prose. Nothing else in the pipeline catches this: status-code-based
// classifiers never look at a 2xx body, and the existing empty-content check
// (hasUsefulContent in nonStreamingHandler.js) only catches structural
// emptiness, not a body that "successfully" carries the wrong text. Without
// this, the error sentence is forwarded to the client as if the model had
// genuinely answered with it, and combo/auto-fallback never triggers.
//
// Deliberately narrow, mirroring the upstream owner's scoping decision:
//   - allowlist-only, starting with the two providers actually reported —
//     never applied globally. This never touches the existing status-code
//     (401/402/403/429) error classifiers; it is a separate, additive check.
//   - the phrase lists below are ported verbatim from OmniRoute's
//     CREDITS_EXHAUSTED_SIGNALS / ACCOUNT_DEACTIVATED_SIGNALS
//     (open-sse/services/accountFallback.ts) — reusing already-curated
//     wording rather than inventing new fuzzy matching.
//   - only trips on SHORT content whose matched signal covers a large
//     fraction of it — a multi-paragraph answer that merely *mentions* the
//     topic is long, and/or the phrase is a small fraction of it, so a real
//     answer is never misclassified.
import { isObject, isString } from "../../src/shared/utils/typeChecks.js";


const FAKE_SUCCESS_BODY_ALLOWLIST = new Set(["pollinations", "perplexity-web"]);

export const CREDITS_EXHAUSTED_SIGNALS = [
  "insufficient_quota",
  "billing_hard_limit_reached",
  "exceeded your current quota",
  "exceeded your current usage quota",
  "credit_balance_too_low",
  "your credit balance is too low",
  "credits exhausted",
  "out of credits",
  "payment required",
  "free tier of the model has been exhausted",
  "tier has been exhausted",
  "insufficient balance",
  "insufficient_balance",
  "insufficient account balance",
  "insufficient credit balance",
  "insufficient credits",
  "insufficient credit",
  "exhausted all your credits"
];

export const ACCOUNT_DEACTIVATED_SIGNALS = [
  "account_deactivated",
  "account has been deactivated",
  "account has been disabled",
  "your account has been suspended",
  "this account is deactivated",
  "verify your account to continue",
  "this service has been disabled in this account for violation",
  "this service has been disabled in this account"
];

/** Exported for tests; not meant as a general-purpose provider predicate. */
export function isFakeSuccessBodyAllowlistedProvider(provider) {
  if (!provider) return false;
  return FAKE_SUCCESS_BODY_ALLOWLIST.has(String(provider).toLowerCase());
}

// A real prose answer runs to paragraphs; a disguised upstream error is one
// short sentence. Generous headroom above every known signal phrase while
// still excluding genuine longer completions that merely mention the topic.
const FAKE_SUCCESS_MAX_CONTENT_LENGTH = 400;

// The matched signal alone must make up a meaningful share of the message —
// keeps a legitimate answer that references the phrase in passing (as part
// of a much larger sentence/paragraph) from tripping this classifier.
const FAKE_SUCCESS_MIN_SIGNAL_COVERAGE = 0.12;

function matchedSignalCoverage(lowerText, signals) {
  let best = 0;
  for (const signal of signals) {
    if (lowerText.includes(signal) && signal.length > best) best = signal.length;
  }
  return lowerText.length > 0 ? best / lowerText.length : 0;
}

/**
 * Classify a *successful* (2xx) response's assistant-message text as a
 * disguised upstream failure. Returns "quota_exhausted", "account_deactivated",
 * or null when the provider is not on the allowlist, the content is too long
 * to be a bare error sentence, or no known signal phrase dominates it.
 *
 * Only ever meaningful for the narrow provider allowlist above — see
 * isFakeSuccessBodyAllowlistedProvider.
 */
export function classifyFakeSuccessBody(content, provider) {
  if (!isFakeSuccessBodyAllowlistedProvider(provider)) return null;

  const text = String(content || "").trim();
  if (!text || text.length > FAKE_SUCCESS_MAX_CONTENT_LENGTH) return null;

  const lower = text.toLowerCase();
  if (matchedSignalCoverage(lower, CREDITS_EXHAUSTED_SIGNALS) >= FAKE_SUCCESS_MIN_SIGNAL_COVERAGE) {
    return "quota_exhausted";
  }
  if (matchedSignalCoverage(lower, ACCOUNT_DEACTIVATED_SIGNALS) >= FAKE_SUCCESS_MIN_SIGNAL_COVERAGE) {
    return "account_deactivated";
  }
  return null;
}

/**
 * Join every text-bearing field of a translated non-streaming response into
 * one string, for classifyFakeSuccessBody above. Mirrors the shapes
 * nonStreamingHandler.js's own hasUsefulContent already recognizes as "real"
 * content — reasoning/tool_calls are intentionally excluded, since a
 * disguised upstream error always surfaces as visible assistant text, never
 * as a reasoning trace.
 */
export function extractAssistantText(translatedResponse) {
  const parts = [];
  if (Array.isArray(translatedResponse?.choices)) {
    for (const choice of translatedResponse.choices) {
      const content = choice?.message?.content;
      if (isString(content)) {
        parts.push(content);
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (block !== null && isObject(block) && block.type === "text" && isString(block.text)) {
            parts.push(block.text);
          }
        }
      }
    }
  } else if (translatedResponse?.type === "message" && Array.isArray(translatedResponse.content)) {
    for (const block of translatedResponse.content) {
      if (block?.type === "text" && isString(block.text)) parts.push(block.text);
    }
  }
  return parts.join(" ");
}
