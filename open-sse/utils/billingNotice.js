// OmniRoute #20530: the streaming twin of the fake-success body check. An
// upstream can answer HTTP 200 and deliver its billing refusal as ordinary text
// deltas. It shares the classifier's provider allowlist, because the text must
// be held until the stream ends before it can be judged.
import { classifyFakeSuccessBody, isFakeSuccessBodyAllowlistedProvider } from "../services/fakeSuccessBodyClassifier.js";
import { textOnlyDelta } from "./unavailableNotice.js";

const EXHAUSTION_PATTERN =
  /\b(enough\s+credits?|not\s+enough\s+credits?|please\s+top\s+up|top\s+up\s+to\s+continue|purchase\s+(more\s+)?credits?|add\s+credits?\s+to\s+continue|credit\s+balance\s+(is\s+)?(too\s+low|exhausted|empty)|recharge\s+(your|the)\s+account|out\s+of\s+funds)\b/i;
// A masked notice is a short canned message; longer text is a real answer.
const NOTICE_MAX_CHARS = 512;

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
      return EXHAUSTION_PATTERN.test(text) || classifyFakeSuccessBody(text, provider) ? text : null;
    }
  };
}
