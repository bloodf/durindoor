// Authorization is a CORS non-wildcard request header and must be named explicitly.
export const CORS_ALLOW_HEADERS = "Authorization, *";

export function corsHeaders(methods) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": methods.join(", "),
    "Access-Control-Allow-Headers": CORS_ALLOW_HEADERS,
  };
}
