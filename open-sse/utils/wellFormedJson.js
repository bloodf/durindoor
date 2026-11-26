// A string cut inside a UTF-16 pair leaves a lone surrogate. JSON.stringify
// writes it as `\ud800`, which Anthropic rejects with a 400 ("unexpected end of
// hex escape"), ending the client's turn.
import { isRecord, isString } from "../../src/shared/utils/typeChecks.js";

const wellFormed = (value) => value.isWellFormed() ? value : value.toWellFormed();

function replacer(_key, value) {
  if (isString(value)) return wellFormed(value);
  if (!isRecord(value) || Object.keys(value).every((key) => key.isWellFormed())) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [wellFormed(key), item]));
}

/** Serialize with lone surrogates (in values and keys) replaced by U+FFFD. */
export function stringifyWellFormed(body) {
  return JSON.stringify(body, replacer);
}
