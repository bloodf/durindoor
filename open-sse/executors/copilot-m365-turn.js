/**
 * Typed outcomes of one Microsoft 365 Copilot turn: licence refusals, throttling, exhausted
 * credits and safety stops read from the final SignalR frames.
 *
 * Ported from OmniRoute (cheaper-inference/OmniRoute, MIT) `open-sse/executors/m365Turn.ts` at
 * 5ffa68e835442a12ed1204a2eebf4076c298aecb: the error table, `M365TurnError` and the final-result
 * classification. The socket transport itself stays DurinDoor's own loop in `copilot-m365-web.js`,
 * which calls `m365FrameError` on every frame after the handshake.
 */
import { sanitizeErrorMessage } from "../utils/error.js";
import { isNumber, isRecord, isString } from "../../src/shared/utils/typeChecks.js";

const ERRORS = {
  M365_THROTTLED: [429, "Microsoft 365 Copilot request throttled."],
  M365_OUT_OF_CREDITS: [429, "Microsoft 365 Copilot credits exhausted."],
  // A per-account cap on reasoning ("Think deeper") turns; the Quick tones keep serving.
  M365_REASONING_TURNS_EXHAUSTED: [
  429,
  "Microsoft 365 Copilot reasoning (Think deeper) turns are used up. Quick-response models may still work."],

  M365_FORBIDDEN: [403, "Microsoft 365 Copilot access denied."],
  // A content-less turn Copilot dropped.
  M365_INTERNAL_ERROR: [502, "Microsoft 365 Copilot could not complete the turn."],
  // Its safety filter declined this request: a request-scoped provider safety stop.
  M365_DISENGAGED: [400, "Microsoft 365 Copilot declined this request."]
};

/** Upstream licence codes that may be echoed back to the client, nothing else. */
export const M365_LICENSE_CODES = Object.freeze([
"PremiumModelUnavailableForLicense",
"ClaudeUnavailableForLicense",
"ForbiddenRequest",
"InvalidCopilotLicense"]
);

function retrySeconds(value) {
  return isNumber(value) && Number.isFinite(value) && value > 0 ? Math.min(604_800, Math.ceil(value)) : undefined;
}

export class M365TurnError extends Error {
  constructor(code, metadata = {}) {
    const [status, message] = ERRORS[code];
    super(sanitizeErrorMessage(message));
    this.name = "M365TurnError";
    this.code = code;
    this.status = status;
    // Copy only validated scalars, never upstream text, objects or causes.
    if (M365_LICENSE_CODES.includes(metadata.upstreamErrorCode)) this.upstreamErrorCode = metadata.upstreamErrorCode;
    const retry = retrySeconds(metadata.retryAfterSeconds);
    if (retry !== undefined) this.retryAfterSeconds = retry;
    if (metadata.priorityWindow === "day" || metadata.priorityWindow === "week") this.priorityWindow = metadata.priorityWindow;
    if (metadata.quotaResetSource === "priority_access" || metadata.quotaResetSource === "unknown") {
      this.quotaResetSource = metadata.quotaResetSource;
    }
  }
}

function finalItem(frame) {
  const argument = Array.isArray(frame.arguments) ? frame.arguments[0] : undefined;
  const item = frame.item ?? (isRecord(argument) ? argument.item : undefined);
  const canonical = Array.isArray(item) ? item[0] : item;
  return isRecord(canonical) ? canonical : undefined;
}

// Match only a refusal opener, never quoted prose or a bare mention of Monday.
const PRIORITY_ACCESS_RE =
/^(?:you['’]ve|you have)\s+used\s+(?:up\s+)?(?:all\s+of\s+)?your\s+(?:available\s+)?priority\s+access(?:\s+to\s+the\s+[\w.\- ]{1,32}?\s+model)?\s+for\s+(?:the\s+)?(today|day|week|this\s+week)\b/i;

function creditMetadata(result, now = new Date()) {
  const match = isString(result.message) ? result.message.trim().slice(0, 512).match(PRIORITY_ACCESS_RE) : null;
  if (!match) return { quotaResetSource: "unknown" };
  const priorityWindow = match[1].toLowerCase().includes("week") ? "week" : "day";
  const days = priorityWindow === "week" ? (8 - now.getUTCDay()) % 7 || 7 : 1;
  const reset = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days);
  return {
    priorityWindow,
    retryAfterSeconds: Math.max(1, Math.ceil((reset - now.getTime()) / 1000)),
    quotaResetSource: "priority_access"
  };
}

function hasDisengagedMessage(item) {
  return isRecord(item) && Array.isArray(item.messages) &&
  item.messages.some((message) => isRecord(message) && message.messageType === "Disengaged");
}

function finalResultError(result) {
  if (!result) return undefined;
  switch (result.value) {
    case "Throttled":
    case "PerUserThrottled":
      // Observed throttling.metering is usage, not a retry/reset hint.
      return new M365TurnError("M365_THROTTLED", { retryAfterSeconds: retrySeconds(result.retryAfter) });
    case "OutOfCredits":
      // The code, not the text, tells the reasoning cap apart from a model's priority access.
      if (result.errorCode === "ReasoningTurnExhausted") {
        return new M365TurnError("M365_REASONING_TURNS_EXHAUSTED", { quotaResetSource: "unknown" });
      }
      return new M365TurnError("M365_OUT_OF_CREDITS", creditMetadata(result));
    case "ForbiddenRequest":
    case "InvalidCopilotLicense":
      return new M365TurnError("M365_FORBIDDEN", { upstreamErrorCode: result.value });
    case "Disengaged":
      return new M365TurnError("M365_DISENGAGED");
    case "InternalError":
      return new M365TurnError("M365_INTERNAL_ERROR");
    default:
      return undefined;
  }
}

/**
 * The typed failure a frame reports, or undefined. Unlike OmniRoute, an unknown final
 * `result.value` is not a failure here: DurinDoor's loop keeps its existing completion handling.
 */
export function m365FrameError(frame) {
  if (!isRecord(frame)) return undefined;
  const item = frame.type === 2 ? finalItem(frame) : undefined;
  const result = item && isRecord(item.result) ? item.result : undefined;
  // A model/account licence refusal takes precedence over the generic result value.
  if (result && M365_LICENSE_CODES.includes(result.errorCode)) {
    return new M365TurnError("M365_FORBIDDEN", { upstreamErrorCode: result.errorCode });
  }
  const containers = frame.type === 1 && Array.isArray(frame.arguments) ? frame.arguments : frame.type === 2 ? [item] : [];
  if (containers.some(hasDisengagedMessage)) return new M365TurnError("M365_DISENGAGED");
  if (frame.type === 2) return finalResultError(result);
  return undefined;
}

/** A refused WebSocket upgrade answered 429: throttled, with the bounded Retry-After when sent. */
export function m365UpgradeThrottle(response) {
  if (!isRecord(response) || response.statusCode !== 429) return undefined;
  const headers = isRecord(response.headers) ? response.headers : {};
  return new M365TurnError("M365_THROTTLED", { retryAfterSeconds: Number(headers["retry-after"]) });
}
