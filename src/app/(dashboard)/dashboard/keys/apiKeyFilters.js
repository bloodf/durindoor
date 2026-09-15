/**
 * Pure filter/search helpers for the API Keys list.
 *
 * Kept out of the page component so the semantics are testable directly: which
 * keys a filter hides is a correctness question (an operator acting on the
 * wrong credential is the failure mode), not a rendering detail.
 */
import { isString } from "@/shared/utils/typeChecks";

/** Groups selected together match keys in ANY of them (OR), not all (AND). */
export function matchesGroupFilter(key, selectedGroupIds) {
  if (!Array.isArray(selectedGroupIds) || selectedGroupIds.length === 0) return true;
  const keyGroups = Array.isArray(key?.groupIds) ? key.groupIds : [];
  return selectedGroupIds.some((groupId) => keyGroups.includes(groupId));
}

/**
 * Case-insensitive substring match on the key's name only.
 *
 * Deliberately NOT matching group names: searching "CI" would otherwise pull in
 * every key of a group called CI alongside a key literally named "ci-deploy",
 * and the two sets are not interchangeable. Group membership is what the group
 * filter is for.
 */
export function matchesSearch(key, query) {
  const term = isString(query) ? query.trim().toLowerCase() : "";
  if (!term) return true;
  const name = isString(key?.name) ? key.name.toLowerCase() : "";
  return name.includes(term);
}

/** Apply both the group filter and the search term. */
export function filterApiKeys(keys, { selectedGroupIds = [], search = "" } = {}) {
  const rows = Array.isArray(keys) ? keys : [];
  return rows.filter(
    (key) => matchesGroupFilter(key, selectedGroupIds) && matchesSearch(key, search),
  );
}

/**
 * Human-readable group labels for one key, resolved against the group list.
 *
 * Ids with no matching group are dropped rather than rendered raw: a dangling
 * uuid in the UI reads as corruption.
 */
export function groupLabelsForKey(key, groups) {
  const byId = new Map((Array.isArray(groups) ? groups : []).map((group) => [group.id, group.name]));
  const ids = Array.isArray(key?.groupIds) ? key.groupIds : [];
  return ids.map((id) => byId.get(id)).filter(Boolean);
}
