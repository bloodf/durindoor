import { PROVIDERS } from "../config/providers.js";
import { isString } from "../../src/shared/utils/typeChecks.js";

/**
 * Resolve an inline-thinking response quirk from the exact selected transport
 * and model id. A similarly named model on another provider is intentionally
 * not eligible.
 */
export function resolveInlineThinkingFormat(provider, model, targetFormat) {
  const config = PROVIDERS[provider];
  if (!config || !isString(model) || !isString(targetFormat)) return null;

  const transport = Array.isArray(config.transports) ?
  config.transports.find((candidate) => candidate?.format === targetFormat) :
  null;
  const selected = transport || (config.format === targetFormat ? config : null);
  const policy = selected?.quirks?.inlineThinking;
  if (!policy || !Array.isArray(policy.models) || !policy.models.includes(model)) return null;
  return policy.format || null;
}
