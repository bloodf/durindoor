export const CORS_ALLOW_HEADERS = [
  "Authorization",
  "Content-Type",
  "x-api-key",
  "anthropic-version",
  "anthropic-beta",
  "x-goog-api-key",
  "x-connection-id",
  "x-9r-cli-token",
].join(", ");

export function corsHeaders(methods) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": methods.join(", "),
    "Access-Control-Allow-Headers": CORS_ALLOW_HEADERS,
  };
}
