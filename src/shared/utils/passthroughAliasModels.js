import { isString } from "./typeChecks.js";

/** Include both canonical provider IDs and their existing short aliases. */
export function passthroughAliasModels(modelAliases, providerId, alias) {
  const prefixes = [...new Set([providerId, alias])].map((id) => `${id}/`);
  return Object.entries(modelAliases).flatMap(([name, value]) => {
    if (!isString(value)) return [];
    const prefix = prefixes.find((candidate) => value.startsWith(candidate));
    return prefix ? [{ id: value.slice(prefix.length), name, value }] : [];
  });
}
