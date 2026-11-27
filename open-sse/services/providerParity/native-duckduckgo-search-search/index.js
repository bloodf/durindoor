export * from "./config.js";
export {
  duckduckgoSearchAdapter, parseSearchParams, buildDuckDuckGoRequest, parseDuckDuckGoLite,
  resolveResultUrl, isAnomalyPage, normalizeSearch, MAX_QUERY_CHARS, MAX_HTML_BYTES,
} from "./adapter.js";
export { handleDuckDuckGoFreeSearchNative, discoverDuckDuckGoFreeModels, MAX_DEADLINE_MS } from "./service.js";
