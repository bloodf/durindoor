/** Add served-route metadata to a successful response, unless disabled by the operator.
 * No connection identifiers or account names are exposed. */
export function withRouteResponseHeaders(response, { provider, model, combo, attempts } = {}) {
  if (!response?.ok || /^(?:0|false)$/i.test(process.env.DURINDOOR_ROUTE_HEADERS || "")) return response;
  const headers = new Headers(response.headers);
  const exposed = new Set((headers.get("access-control-expose-headers") || "").split(",").map((value) => value.trim()).filter(Boolean));
  for (const [name, value] of Object.entries({ provider, model, combo, attempts })) {
    if (value === undefined || value === null || value === "") continue;
    const text = String(value);
    // Header values must be representable and cannot contain control characters.
    if (!/^[\x20-\x7e]+$/.test(text)) continue;
    headers.set(`x-durindoor-${name}`, text);
    exposed.add(`x-durindoor-${name}`);
  }
  if (exposed.size) headers.set("access-control-expose-headers", [...exposed].join(", "));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
