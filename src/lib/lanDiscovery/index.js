/**
 * Opt-in LAN discovery of Ollama and OpenAI-compatible endpoints (#2025).
 */

export {
  DEFAULT_PORTS,
  MAX_ADDRESSES,
  MAX_PORTS,
  expandCidr,
  normalizeHosts,
  normalizePorts,
  parseIpv4,
  formatIpv4,
  resolveScanTargets,
} from "./cidr.js";

export { mapWithConcurrency, MAX_IN_FLIGHT } from "./concurrency.js";

export {
  PROBE_TIMEOUT_MS,
  buildProbeUrl,
  ollamaBaseUrl,
  openaiCompatibleBaseUrl,
  extractOllamaModels,
  extractOpenAIModels,
  probeEndpoint,
} from "./probe.js";

export { scanLanDiscovery } from "./scan.js";
