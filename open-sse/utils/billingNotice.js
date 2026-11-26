// OmniRoute #20530: the streaming twin of the fake-success body check. An
// upstream can answer HTTP 200 and deliver its billing refusal as ordinary text
// deltas. It shares the classifier's provider allowlist, because the text must
// be held until the stream ends before it can be judged.
import { isFakeSuccessBodyAllowlistedProvider } from "../services/fakeSuccessBodyClassifier.js";
import { textOnlyDelta } from "./unavailableNotice.js";

const EXHAUSTION_PATTERN =
  /\b((?:not|doesn't\s+have|does\s+not\s+have)\s+enough\s+credits?|insufficient\s+(?:credits?|(?:account\s+|credit\s+)?balance)|please\s+top\s+up|top\s+up\s+to\s+continue|purchase\s+(more\s+)?credits?|add\s+credits?\s+to\s+continue|credit\s+balance\s+(is\s+)?(too\s+low|exhausted|empty)|recharge\s+(your|the)\s+account|out\s+of\s+funds)\b/gi;
// A masked notice is short, and its refusal phrases occupy a meaningful share.
const NOTICE_MAX_CHARS = 512;
const QUOTED_SPAN = /"[^"\n]*"|“[^”\n]*”|‘[^’\n]*’|`[^`\n]*`|(?<![\p{L}\p{N}])'[^'\n]*'(?![\p{L}\p{N}])/gu;
const QUOTE_EDGES = /^["“”‘’'`\s]+|["“”‘’'`\s.!]+$/g;

// Ignore quoted spans when surrounding words show the text is an answer about them.
function unquotedText(trimmed) {
  const unquoted = trimmed.replace(QUOTED_SPAN, " ");
  const words = unquoted.match(/[\p{L}\p{N}]+/gu) ?? [];
  return words.length > 1 ? unquoted : trimmed.replace(QUOTE_EDGES, "");
}

/** True when the provider itself counted output tokens. Gateway estimates do not count. */
function reportsCompletionUsage(frame) {
  const usage = frame?.usage ?? frame?.response?.usage;
  return !usage?.estimated && (usage?.completion_tokens ?? usage?.output_tokens) > 0;
}

/**
 * Holds one stream's text while it can still be a billing notice. Returns null
 * for providers outside the allowlist. A caller must wait for stream completion
 * before it reads `notice()`.
 */
export function createBillingNoticeGate(provider) {
  if (!isFakeSuccessBodyAllowlistedProvider(provider)) return null;
  let text = "";
  let released = false;
  const release = () => {
    released = true;
    return "content";
  };
  return {
    get holding() { return !released && text.length > 0; },
    /** Decides on a frame that carries output: "hold" or "content". */
    push(frame) {
      const delta = textOnlyDelta(frame);
      if (released || delta === null || reportsCompletionUsage(frame)) return release();
      text += delta;
      return text.length < NOTICE_MAX_CHARS ? "hold" : release();
    },
    /** True when a frame without output proves the held text is a real answer. */
    observe(frame) {
      if (!this.holding || !reportsCompletionUsage(frame)) return false;
      release();
      return true;
    },
    notice() {
      if (!this.holding) return null;
      const trimmed = text.trim();
      const matches = [...unquotedText(trimmed).matchAll(EXHAUSTION_PATTERN)];
      const phraseLength = matches.reduce((total, match) => total + match[0].length, 0);
      return phraseLength / trimmed.length >= 0.2 ? text : null;
    }
  };
}
