// Concern #6: finish_reason / stop_reason mapping.
// One entry per direction; switch by special format, default handles common providers.
import { OPENAI_FINISH, CLAUDE_STOP, GEMINI_FINISH, GEMINI_ERROR_FINISH_REASONS, GEMINI_CONTENT_FILTER_FINISH_REASONS } from "../schema/finishReasons.js";
import { isString } from "../../../src/shared/utils/typeChecks.js";

const CLAUDE_STOP_VALUES = new Set(Object.values(CLAUDE_STOP));

/**
 * Map a Claude `stop_reason` literal that an OpenAI-shaped provider put in
 * `finish_reason` to its OpenAI equivalent. Some OpenAI-compatible upstreams answer
 * with `end_turn` / `tool_use` / ..., and strict OpenAI clients read a value outside
 * their vocabulary as a provider fault and drop the turn. Every other value, including
 * abort reasons that must not look like a clean stop, is returned unchanged.
 */
export function normalizeOpenAIFinish(reason) {
  if (!isString(reason)) return reason;
  const lower = reason.toLowerCase();
  return CLAUDE_STOP_VALUES.has(lower) ? toOpenAIFinish(lower, "claude") : reason;
}

// upstream finish/stop reason → OpenAI finish_reason
export function toOpenAIFinish(reason, format) {
  switch (format) {
    case "claude":
      switch (reason) {
        case CLAUDE_STOP.END_TURN: return OPENAI_FINISH.STOP;
        case CLAUDE_STOP.MAX_TOKENS: return OPENAI_FINISH.LENGTH;
        case CLAUDE_STOP.TOOL_USE: return OPENAI_FINISH.TOOL_CALLS;
        case CLAUDE_STOP.STOP_SEQUENCE: return OPENAI_FINISH.STOP;
        // A refusal is a blocked turn, not a clean stop: with the default mapping an
        // OpenAI client saw finish_reason "stop" and an empty message (9Router logged
        // "succeeded", OUT 0) and could not tell it from a real answer.
        case CLAUDE_STOP.REFUSAL: return OPENAI_FINISH.CONTENT_FILTER;
        // The context window filled mid-turn, not the requested output budget, but
        // OpenAI has no separate reason for it either; "length" is what already
        // tells a client the turn was cut short and to expect a truncated answer.
        case CLAUDE_STOP.MODEL_CONTEXT_WINDOW_EXCEEDED: return OPENAI_FINISH.LENGTH;
        // A paused server-tool turn is not finished: the default mapping told an
        // OpenAI client "stop" and it would drop the turn instead of sending the
        // response back to continue. "tool_calls" is the only OpenAI reason that
        // already means "the client must act before this turn is done".
        case CLAUDE_STOP.PAUSE_TURN: return OPENAI_FINISH.TOOL_CALLS;
        default: return OPENAI_FINISH.STOP;
      }
    case "commandcode":
      switch (reason) {
        case "stop": return OPENAI_FINISH.STOP;
        case "length": return OPENAI_FINISH.LENGTH;
        case "tool-calls":
        case "tool_use": return OPENAI_FINISH.TOOL_CALLS;
        case "content-filter": return OPENAI_FINISH.CONTENT_FILTER;
        case "error": return OPENAI_FINISH.STOP;
        default: return reason || OPENAI_FINISH.STOP;
      }
    case "gemini": {
      const geminiReason = String(reason).toUpperCase();
      // Aborted turns (MALFORMED_FUNCTION_CALL, OTHER, ...) must surface as errors,
      // not clean stops — a clean stop makes the client treat a broken turn as done.
      if (GEMINI_ERROR_FINISH_REASONS.has(geminiReason)) return OPENAI_FINISH.ERROR;
      if (GEMINI_CONTENT_FILTER_FINISH_REASONS.has(geminiReason)) return OPENAI_FINISH.CONTENT_FILTER;
      switch (geminiReason) {
        case GEMINI_FINISH.STOP: return OPENAI_FINISH.STOP;
        case GEMINI_FINISH.MAX_TOKENS: return OPENAI_FINISH.LENGTH;
        // Unknown values stay a clean stop: a future benign Gemini reason must not
        // start erroring every Gemini-family provider at once.
        default: return OPENAI_FINISH.STOP;
      }
    }
    case "kiro":
    case "ollama":
      switch (reason) {
        case "tool_calls":
        case "tool_use": return OPENAI_FINISH.TOOL_CALLS;
        case "length":
        case "max_tokens": return OPENAI_FINISH.LENGTH;
        default: return OPENAI_FINISH.STOP;
      }
    default:
      return reason || OPENAI_FINISH.STOP;
  }
}

// OpenAI finish_reason → upstream stop reason
export function fromOpenAIFinish(reason, format) {
  switch (format) {
    case "claude":
      switch (reason) {
        case OPENAI_FINISH.STOP: return CLAUDE_STOP.END_TURN;
        // Some OpenAI-shaped providers emit Claude literals instead of the
        // standard OpenAI aliases; preserve their Claude stop semantics.
        case OPENAI_FINISH.LENGTH:
        case "max_tokens": return CLAUDE_STOP.MAX_TOKENS;
        case OPENAI_FINISH.TOOL_CALLS:
        case "tool_use": return CLAUDE_STOP.TOOL_USE;
        // OpenAI's own content_filter means the provider's moderation layer blocked
        // the turn, not that the model itself refused - collapsing it to Claude's
        // "refusal" mis-signals every content-filter provider (Antigravity, Vertex,
        // Gemini CLI, commandcode) as a model refusal. Only the literal Claude
        // "refusal" alias round-trips to CLAUDE_STOP.REFUSAL.
        case CLAUDE_STOP.REFUSAL: return CLAUDE_STOP.REFUSAL;
        default: return CLAUDE_STOP.END_TURN;
      }
    default:
      return reason;
  }
}
