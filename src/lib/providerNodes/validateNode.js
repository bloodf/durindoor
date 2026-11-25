/**
 * One provider-node validation shared by the create route, the update route and
 * nodesRepo insert/update, so every entry point applies the same rules and
 * returns the same messages and HTTP statuses.
 *
 * `strict` (routes): name and prefix are required, an OpenAI-compatible node
 * needs a valid apiType, and the base URL is required unless the caller passes
 * a `baseUrlDefault`. Lenient (repo): only fields that are present are checked,
 * because internal callers may insert partial nodes or patch a single field.
 */
import { normalizeSystemoneBaseUrl } from "open-sse/config/systemone.js";
import { assertOutboundUrlAllowed } from "open-sse/utils/outboundUrlGuard.js";
import { isValidProviderIconUrl } from "../../shared/utils/providerIcon.js";
import { isString } from "../../shared/utils/typeChecks.js";

export const PROVIDER_NODE_INVALID = "PROVIDER_NODE_INVALID";
export const OPENAI_COMPATIBLE_API_TYPES = ["chat", "responses"];

export class ProviderNodeValidationError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "ProviderNodeValidationError";
    this.code = PROVIDER_NODE_INVALID;
    this.status = status;
  }
}

function isAllowedNodeBaseUrl(value) {
  try {
    assertOutboundUrlAllowed(value);
    return true;
  } catch {
    return false;
  }
}

function fail(error, status = 400) {
  return { ok: false, error, status };
}

// Drop the endpoint suffix a user may paste so it is not appended twice at runtime.
export function normalizeNodeBaseUrl(type, baseUrl) {
  let value = baseUrl.trim();
  if (type === "anthropic-compatible") {
    value = value.replace(/\/$/, "");
    if (value.endsWith("/messages")) value = value.slice(0, -"/messages".length);
  } else if (type === "custom-embedding") {
    value = value.replace(/\/$/, "");
    if (value.endsWith("/embeddings")) value = value.slice(0, -"/embeddings".length);
  } else if (type === "systemone-compatible") {
    value = normalizeSystemoneBaseUrl(value);
  }
  return value;
}

/**
 * @param {object} input node fields (name, prefix, apiType, baseUrl, iconUrl)
 * @param {{ type?: string, strict?: boolean, baseUrlDefault?: string }} [options]
 * @returns {{ ok: true, value: object } | { ok: false, error: string, status: number }}
 */
export function validateProviderNode(input, { type, strict = false, baseUrlDefault } = {}) {
  const { name, prefix, apiType, baseUrl, iconUrl } = input || {};
  const value = {};
  // Routes treat only `undefined` as absent; repo callers also pass null for "unset".
  const present = (field) => (strict ? field !== undefined : field != null);

  if (baseUrl !== undefined && baseUrl !== null && !isString(baseUrl)) return fail("Invalid base URL");

  if (strict || present(name)) {
    if (!isString(name) || !name.trim()) return fail("Name is required");
    value.name = name.trim();
  }

  if (strict || (present(prefix) && prefix !== "")) {
    if (!isString(prefix) || !prefix.trim()) return fail("Prefix is required");
    value.prefix = prefix.trim();
  }

  if (present(iconUrl)) {
    if (!isValidProviderIconUrl(iconUrl)) return fail("Invalid icon URL");
    value.iconUrl = iconUrl.trim();
  }

  if (type === "openai-compatible" && (strict || present(apiType))) {
    if (!OPENAI_COMPATIBLE_API_TYPES.includes(apiType)) return fail("Invalid OpenAI compatible API type");
    value.apiType = apiType;
  }

  if (strict || present(baseUrl)) {
    const raw = isString(baseUrl) && baseUrl.trim() ? baseUrl : baseUrlDefault;
    if (!isString(raw) || !raw.trim()) return fail("Base URL is required");
    if (!isAllowedNodeBaseUrl(raw.trim())) return fail("Invalid or blocked base URL");
    try {
      value.baseUrl = normalizeNodeBaseUrl(type, raw);
    } catch (error) {
      return fail(error.message);
    }
    if (!isAllowedNodeBaseUrl(value.baseUrl)) return fail("Invalid or blocked base URL");
  }

  return { ok: true, value };
}

export function assertValidProviderNode(input, options) {
  const result = validateProviderNode(input, options);
  if (!result.ok) throw new ProviderNodeValidationError(result.error, result.status);
  return result.value;
}
