/**
 * Recover namespaced Responses tool identities from a request's own history.
 *
 * A Responses request declares its namespace tools in `tools`, but the
 * declaration is not always present in the follow-up turn: a client that
 * continues a conversation with `previous_response_id` (or that simply drops
 * the `tools` array) sends only the `input` history. The history items still
 * carry the `{ namespace, name }` identity of every earlier call, so the
 * response translator can restore the namespace instead of forwarding the
 * dotted wire name flat.
 *
 * Current declarations always win. History only fills gaps, and an ambiguous
 * history (two different namespaces for the same wire name) stays flat rather
 * than guessing a namespace.
 *
 * Ported from OmniRoute #15974.
 */

import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";

/**
 * Collect the namespace identity each historical `function_call` carries.
 * @param {unknown[]} input - the request's `input` items
 * @returns {Map<string, {namespace: string, name: string}>} wire name → identity
 */
export function collectHistoricalToolIdentities(input) {
  const identities = new Map();
  if (!Array.isArray(input)) return identities;

  for (const value of input) {
    if (!isRecord(value)) continue;
    const item = value;
    if (item.type !== "function_call") continue;
    if (!isString(item.call_id) || !item.call_id.trim()) continue;

    const namespace = isString(item.namespace) ? item.namespace : "";
    const name = isString(item.name) ? item.name.trim() : "";
    if (!namespace.trim() || !name) continue;

    const wireName = `${namespace}.${name}`;
    const previous = identities.get(wireName);
    // Two different identities can share one wire name (a namespace whose name
    // already ends in the leaf). Preserve that ambiguity instead of picking by
    // order: an ambiguous identity stays flat.
    const ambiguous = previous && (previous.namespace !== namespace || previous.name !== name);
    identities.set(wireName, ambiguous ? { namespace: "", name: wireName } : { namespace, name });
  }
  return identities;
}

/**
 * Merge the historical identities into the current namespace map.
 *
 * `current` holds the namespaces this request declares; it is never
 * overwritten. The map is mutated in place.
 *
 * @param {Record<string, string>} current - wire name → namespace
 * @param {unknown[]} input - the request's `input` items
 */
export function mergeHistoricalToolIdentities(current, input) {
  const historical = collectHistoricalToolIdentities(input);
  if (historical.size === 0) return;

  for (const [wireName, identity] of historical) {
    // A current declaration wins: the client re-declared the namespace, so the
    // history's (possibly stale) identity must not override it.
    if (!Object.hasOwn(current, wireName)) current[wireName] = identity.namespace;
  }
}
