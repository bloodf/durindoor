import { resolveModelLimits } from "../providers/capabilities.js";
import { stripThinkingSuffix } from "../translator/concerns/thinkingSuffix.js";
import { isString } from "../../src/shared/utils/typeChecks.js";

const HEADER_VALUE_RE = /^[\x20-\x7e]+$/;

/**
 * Build informational response headers naming the resolved model that served
 * the request and its context window when known by capability lookup.
 * Never exposes credentials, account names, or connection identifiers.
 */
export function resolvedModelHeaders(provider, model) {
  if (!isString(model)) return {};
  const trimmedModel = model.trim();
  if (!trimmedModel || !HEADER_VALUE_RE.test(trimmedModel)) return {};
  const safeProvider = isString(provider) && provider.trim() && HEADER_VALUE_RE.test(provider.trim())
    ? provider.trim()
    : "";
  const headers = {
    "x-durindoor-model": safeProvider ? `${safeProvider}/${trimmedModel}` : trimmedModel,
  };
  let limits = resolveModelLimits(safeProvider || null, trimmedModel);
  if (!limits?.known) {
    const stripped = stripThinkingSuffix(trimmedModel);
    if (stripped && stripped !== trimmedModel) {
      limits = resolveModelLimits(safeProvider || null, stripped);
    }
  }
  if (limits?.known && Number.isFinite(limits.contextWindow) && limits.contextWindow > 0) {
    headers["x-durindoor-context-window"] = String(limits.contextWindow);
  }
  return headers;
}

/** Add served-route metadata to a successful response, unless disabled by the operator.
 * No connection identifiers or account names are exposed. */
export function withRouteResponseHeaders(response, { provider, model, combo, attempts } = {}) {
  if (!response?.ok || /^(?:0|false)$/i.test(process.env.DURINDOOR_ROUTE_HEADERS || "")) return response;
  const headers = new Headers(response.headers);
  const exposed = new Set((headers.get("access-control-expose-headers") || "").split(",").map((value) => value.trim()).filter(Boolean));
  for (const existingHeader of ["x-durindoor-model", "x-durindoor-context-window"]) {
    if (headers.has(existingHeader)) exposed.add(existingHeader);
  }
  for (const [name, value] of Object.entries({ provider, model, combo, attempts })) {
    if (value === undefined || value === null || value === "") continue;
    // Preserve `<provider>/<model>` when already set by resolvedModelHeaders.
    if (name === "model" && headers.has("x-durindoor-model")) continue;
    const text = String(value);
    // Header values must be representable and cannot contain control characters.
    if (!HEADER_VALUE_RE.test(text)) continue;
    headers.set(`x-durindoor-${name}`, text);
    exposed.add(`x-durindoor-${name}`);
  }
  if (exposed.size) headers.set("access-control-expose-headers", [...exposed].join(", "));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
