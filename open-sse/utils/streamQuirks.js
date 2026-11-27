import { PROVIDERS } from "../config/providers.js";
import { CLAUDE_BLOCK } from "../translator/schema/index.js";
import { normalizeOpenAIFinish } from "../translator/concerns/finishReason.js";
import { sanitizeMinimaxDelta } from "./minimaxThinkingStream.js";

/** Ordered passthrough transforms. Wildcards retain the historical cross-provider cleanup. */
export const STREAM_QUIRKS = [
  { provider: "*", format: "*", transform(parsed, { provider, omitBuyerCost, sanitizeMinimaxThinking, minimaxThinkingState }) {
    let fieldsInjected = false;
              if (
              PROVIDERS[provider]?.quirks?.ensureThinkingSignature &&
              parsed.type === "content_block_start" &&
              parsed.content_block?.type === CLAUDE_BLOCK.THINKING &&
              parsed.content_block.signature === undefined)
              {
                parsed.content_block.signature = "";
                fieldsInjected = true;
              }
    return fieldsInjected;
  } },
  { provider: "*", format: "*", transform(parsed, { provider, omitBuyerCost, sanitizeMinimaxThinking, minimaxThinkingState }) {
    let fieldsInjected = false;
              if (parsed.choices !== undefined) {
                if (!parsed.object) {parsed.object = "chat.completion.chunk";fieldsInjected = true;}
                if (!parsed.created) {parsed.created = Math.floor(Date.now() / 1000);fieldsInjected = true;}
              }

    return fieldsInjected;
  } },
  { provider: "*", format: "*", transform(parsed, { provider, omitBuyerCost, sanitizeMinimaxThinking, minimaxThinkingState }) {
    let fieldsInjected = false;
              if (omitBuyerCost(parsed)) fieldsInjected = true;

    return fieldsInjected;
  } },
  { provider: "*", format: "*", transform(parsed, { provider, omitBuyerCost, sanitizeMinimaxThinking, minimaxThinkingState }) {
    let fieldsInjected = false;
              // Strip Azure-specific non-standard fields from streaming chunks
              if (parsed.prompt_filter_results !== undefined) {
                delete parsed.prompt_filter_results;
                fieldsInjected = true;
              }
              if (parsed?.choices) {
                for (const choice of parsed.choices) {
                  if (choice.content_filter_results !== undefined) {
                    delete choice.content_filter_results;
                    fieldsInjected = true;
                  }
                  // Claude stop_reason literals (end_turn, tool_use, ...) are not OpenAI values.
                  const finishReason = normalizeOpenAIFinish(choice.finish_reason);
                  if (finishReason !== choice.finish_reason) {
                    choice.finish_reason = finishReason;
                    fieldsInjected = true;
                  }
                }
              }

    return fieldsInjected;
  } },
  { provider: "*", format: "*", transform(parsed, { provider, omitBuyerCost, sanitizeMinimaxThinking, minimaxThinkingState }) {
    let fieldsInjected = false;
              // Strip empty tool_calls arrays that break AI SDK reasoning tracking.
              // Some providers (e.g. CodeBuddy CN) include `"tool_calls": []` in
              // every streaming delta. @ai-sdk/openai-compatible checks
              // `delta.tool_calls != null` — an empty array passes this check,
              // causing premature `reasoning-end` on every chunk.
              if (parsed?.choices) {
                for (const choice of parsed.choices) {
                  if (choice.delta?.tool_calls && Array.isArray(choice.delta.tool_calls) && choice.delta.tool_calls.length === 0) {
                    delete choice.delta.tool_calls;
                    fieldsInjected = true;
                  }
                }
              }

    return fieldsInjected;
  } },
  { provider: "*", format: "*", transform(parsed, { provider, omitBuyerCost, sanitizeMinimaxThinking, minimaxThinkingState }) {
    let fieldsInjected = false;
              // Peel leaked MiniMax thinking markers out of delta.content into
              // reasoning_content before the inline-thinking extractor and content
              // accounting see them (upstream PR #2525).
              if (sanitizeMinimaxThinking && parsed?.choices?.[0]?.delta) {
                if (sanitizeMinimaxDelta(parsed.choices[0].delta, minimaxThinkingState)) {
                  fieldsInjected = true;
                }
              }

    return fieldsInjected;
  } },
  { provider: "*", format: "*", transform(parsed, { provider, omitBuyerCost, sanitizeMinimaxThinking, minimaxThinkingState }) {
    let fieldsInjected = false;
              // Provider-specific stream normalization (e.g. SenseNova maps
              // delta.reasoning -> delta.reasoning_content) runs before the
              // hasValuableContent gate so reasoning-only chunks survive.
              fieldsInjected = PROVIDERS[provider]?.normalizeStreamChunk?.(parsed) || fieldsInjected;

    return fieldsInjected;
  } }
];

/** Mutate a parsed chunk and report whether its wire representation must be rebuilt. */
export function applyStreamQuirks(parsed, context) {
  let changed = false;
  for (const quirk of STREAM_QUIRKS) {
    if ((quirk.provider === "*" || quirk.provider === context.provider) &&
        (quirk.format === "*" || quirk.format === context.format)) {
      changed = quirk.transform(parsed, context) || changed;
    }
  }
  return changed;
}
