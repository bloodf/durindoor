// Combo routing policy (issue #747 / port of decolua/9router #3748, minus
// the unsafe key-export unit). Resolve persisted policy once per combo request
// so a just-saved allow-list takes effect immediately. Empty / null means
// unrestricted.

import { getComboByName } from "@/lib/localDb";
import { isString } from "../../src/shared/utils/typeChecks.js";

/**
 * Resolve a combo's routing policy by canonical name. Returns the
 * `{ id, name, allowedConnectionIds }` triple, or `null` if no combo
 * with that name exists. Empty `allowedConnectionIds` arrays are
 * surfaced as `null` so callers retain current unrestricted behavior.
 *
 * A future relation filter (e.g. #760) MUST only intersect the
 * returned `allowedConnectionIds`; it must not replace it. The shared
 * selector accepts `allowedConnectionIds` and intersects it with its
 * existing eligible connection set.
 */
export async function getComboRoutingPolicy(name) {
  if (!isString(name) || name.length === 0) return null;
  const combo = await getComboByName(name).catch(() => null);
  if (!combo) return null;
  const hasIds = Array.isArray(combo.allowedConnectionIds) && combo.allowedConnectionIds.length > 0;
  return {
    id: combo.id,
    name: combo.name,
    allowedConnectionIds: hasIds ? combo.allowedConnectionIds.slice() : null,
    restrictionApplied: hasIds
  };
}

/**
 * Combine an outer (top-level, attributed) combo's policy with an inner
 * (nested — e.g. an auto-combo used as a member) combo's own allow-list.
 * Attribution (`id`/`name`) always stays the OUTER combo: that is what the
 * client asked for and what usage reporting must record, even though the
 * inner combo narrowed which connections were eligible.
 *
 * Eligibility is the INTERSECTION of both allow-lists: an inner combo can
 * only ever narrow the outer combo's allow-list, never escape/replace it.
 * `restrictionApplied: true` is set whenever any of {outer, inner, both}
 * carried an explicit allow-list, so the shared selector can honor a
 * derived `[]` (deny-all) and never silently widen to unrestricted.
 * `null` on both sides keeps the current behavior: no restriction.
 */
export function mergeComboRouting(outer, inner) {
  if (!outer && !inner) return null;
  const attribution = outer || inner;
  const outerRestricted = outer?.restrictionApplied === true;
  const innerRestricted = inner?.restrictionApplied === true;
  const outerIds = outerRestricted ? outer.allowedConnectionIds || [] : null;
  const innerIds = innerRestricted ? inner.allowedConnectionIds || [] : null;
  const restrictionApplied = outerRestricted || innerRestricted;
  let allowedConnectionIds;
  if (!outerIds && !innerIds) {
    allowedConnectionIds = null;
  } else if (!outerIds) {
    allowedConnectionIds = innerIds.slice();
  } else if (!innerIds) {
    allowedConnectionIds = outerIds.slice();
  } else {
    const innerSet = new Set(innerIds);
    allowedConnectionIds = outerIds.filter((id) => innerSet.has(id));
  }
  return {
    id: attribution.id,
    name: attribution.name,
    allowedConnectionIds,
    restrictionApplied
  };
}
