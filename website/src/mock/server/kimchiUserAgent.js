// Website stand-in for open-sse/utils/kimchiUserAgent.js. The real module
// starts a GitHub release poll on the server at import time; the public site
// never proxies Kimchi traffic, so it only needs the static fallback.
const FALLBACK_AGENT = "kimchi/0.1.01";

export function getKimchiUserAgent() {
  return FALLBACK_AGENT;
}

export async function updateKimchiUserAgent() {
  return FALLBACK_AGENT;
}
