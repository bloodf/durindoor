/**
 * Validate a compatible-provider connection write against the provider node it
 * is bound to.
 *
 * A compatible node owns its identity: the endpoint (`baseUrl`), the model
 * prefix, the API type, and the node name. A connection that stores a
 * different `baseUrl` than its node sends its API key to a different host
 * than the operator configured, so the node's endpoint must win and a
 * conflicting value must be rejected instead of silently accepted.
 *
 * Ported from OmniRoute #15987.
 */

import { isRecord, isString } from "../../shared/utils/typeChecks.js";

/**
 * Compare a baseUrl that differs only in a trailing pathname slash. The
 * pathname is normalized; the query and fragment are preserved verbatim, so
 * `https://host/v1` and `https://host/v1/` are the same endpoint while
 * `https://host/v1?tenant=team` and `https://host/v1/?tenant=team` are too.
 */
export function normalizeIdentityValue(key, value) {
  if (key !== "baseUrl" || !isString(value)) return value;
  const trimmed = value.trim();
  const separator = trimmed.search(/[?#]/);
  const pathname = separator < 0 ? trimmed : trimmed.slice(0, separator);
  const suffix = separator < 0 ? "" : trimmed.slice(separator);
  return pathname.replace(/\/+$/, "") + suffix;
}

function identityEquals(key, left, right) {
  const a = normalizeIdentityValue(key, left);
  const b = normalizeIdentityValue(key, right);
  if (a === b) return true;
  // Only the endpoint is compared structurally; every other identity field is
  // a plain string and is compared as-is.
  if (key !== "baseUrl") return false;
  if (!isString(a) || !isString(b) || !a || !b) return false;
  return a === b;
}

/**
 * The identity fields a compatible node owns, in the order they are reported.
 * @param {Record<string, unknown>} node
 * @param {boolean} includeApiType - Anthropic-compatible nodes have no apiType.
 * @returns {Record<string, unknown>}
 */
export function compatibleNodeIdentityFields(node, includeApiType) {
  const fields = {
    prefix: node?.prefix,
    baseUrl: node?.baseUrl,
    nodeName: node?.name,
  };
  // Anthropic-compatible nodes have no API type of their own, so the field is
  // added only when the node family carries one.
  if (includeApiType) fields.apiType = node?.apiType;
  return fields;
}

/**
 * Check an incoming `providerSpecificData` against the node's identity.
 *
 * @param {Record<string, unknown>} node - the provider node
 * @param {Record<string, unknown>|null|undefined} incoming - client-supplied data
 * @param {boolean} includeApiType - Anthropic-compatible nodes have no apiType.
 * @returns {{ conflict: string|null, data: Record<string, unknown> }}
 *   `conflict` names the offending field, or null when the incoming data
 *   agrees with the node (or says nothing about it).
 */
export function resolveCompatibleNodeIdentity(node, incoming, includeApiType) {
  const nodeFields = compatibleNodeIdentityFields(node, includeApiType);
  const supplied = isRecord(incoming) ? incoming : {};

  const conflict = Object.keys(nodeFields).find((key) =>
    Object.hasOwn(supplied, key) &&
    supplied[key] !== undefined &&
    !identityEquals(key, supplied[key], nodeFields[key]));

  return {
    conflict: conflict || null,
    // The node's own values win; unrelated client data is preserved.
    data: { ...supplied, ...nodeFields },
  };
}

/**
 * The error message returned for a conflicting node identity.
 * @param {string} conflict
 * @returns {string}
 */
export function compatibleNodeConflictMessage(conflict) {
  return `providerSpecificData.${conflict} conflicts with the provider node this connection belongs to. Use the node's own settings or remove the conflicting field.`;
}
