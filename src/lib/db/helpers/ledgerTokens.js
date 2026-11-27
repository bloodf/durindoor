import { isNumber } from "../../../shared/utils/typeChecks.js";

/**
 * Normalize a raw provider usage object into the one durable ledger shape.
 *
 * Contract (pure; no I/O, no pricing):
 * - Accepts OpenAI (`prompt_tokens`/`completion_tokens`), Responses/Anthropic
 *   (`input_tokens`/`output_tokens`) and Gemini (`promptTokenCount`/
 *   `candidatesTokenCount`) aliases; the first non-null alias wins, but every
 *   supplied alias is validated.
 * - Every count must be a finite nonnegative number; fractional estimates round
 *   up (`Math.ceil`) before pricing and persistence. Anything else throws
 *   `TypeError("Usage token counts must be finite nonnegative numbers")`.
 * - A supplied total (`total_tokens`/`totalTokenCount`) is rounded the same way
 *   and must equal rounded input plus output. Conflicting totals cannot be allocated without
 *   inventing usage, so they throw
 *   `TypeError("Usage total_tokens must equal input and output components")`.
 * - Returns `prompt_tokens`, `completion_tokens`, `total_tokens`,
 *   `cached_tokens`, `reasoning_tokens`, `cache_creation_input_tokens`
 *   (missing components default to 0), `cache_creation_1h_input_tokens` only
 *   when positive, and passes through own cost/credit/`estimated` fields as-is.
 *
 * @param {object} [tokens={}] - Raw usage object from a provider or caller
 * @returns {object} Normalized ledger token object
 * @throws {TypeError} On invalid counts or inconsistent totals
 */
export function normalizeLedgerTokens(tokens = {}) {
  const count = (value) => {
    if (value == null) return undefined;
    if (!isNumber(value) || !Number.isFinite(value) || value < 0 || !Number.isSafeInteger(Math.ceil(value))) {
      throw new TypeError("Usage token counts must be finite nonnegative numbers");
    }
    return Math.ceil(value);
  };
  const first = (...values) => values.map(count).find((value) => value !== undefined);
  const prompt = first(tokens.prompt_tokens, tokens.input_tokens, tokens.promptTokenCount) ?? 0;
  const completion = first(tokens.completion_tokens, tokens.output_tokens, tokens.candidatesTokenCount) ?? 0;
  const cached = first(tokens.cached_tokens, tokens.cache_read_input_tokens,
    tokens.prompt_tokens_details?.cached_tokens, tokens.input_tokens_details?.cached_tokens) ?? 0;
  const reasoning = first(tokens.reasoning_tokens, tokens.completion_tokens_details?.reasoning_tokens,
    tokens.output_tokens_details?.reasoning_tokens, tokens.thoughtsTokenCount) ?? 0;
  const creation = first(tokens.cache_creation_input_tokens,
    tokens.prompt_tokens_details?.cache_creation_tokens, tokens.input_tokens_details?.cache_creation_tokens) ?? 0;
  const oneHourCreation = count(tokens.cache_creation_1h_input_tokens);
  const total = first(tokens.total_tokens, tokens.totalTokenCount);
  if (!Number.isSafeInteger(prompt + completion) || (total !== undefined && total !== prompt + completion)) {
    throw new TypeError("Usage total_tokens must equal input and output components");
  }
  return {
    ...Object.fromEntries(["cost_usd", "cost_in_usd", "cost_in_usd_ticks", "kiro_credits", "kiro_credit_unit", "estimated"]
      .filter((key) => Object.hasOwn(tokens, key)).map((key) => [key, tokens[key]])),
    prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion,
    cached_tokens: cached, reasoning_tokens: reasoning, cache_creation_input_tokens: creation,
    ...(oneHourCreation > 0 ? { cache_creation_1h_input_tokens: oneHourCreation } : null),
  };
}
