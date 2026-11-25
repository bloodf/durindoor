// LMArena browser-TLS transport, adapted from OmniRoute release/v3.8.55
// (4265bb2ad5477450a07d3a43ea33a62c6c874878), services/lmarenaTlsClient.ts.
import { createTlsClientModule } from "./tlsClientBase.js";

const module = createTlsClientModule({
  providerName: "LMArena",
  tlsProfile: "chrome_136",
  emulationOs: "windows",
  domain: "https://arena.ai",
  proxyDomainOverride: "https://arena.ai",
  tempDirPrefix: "lmarena-stream-",
  tailFileVariant: "A",
  responseValidation: "cf",
  exportCloudflareCheck: true,
  defaultTimeoutMs: 60_000,
  hardTimeoutGraceMs: 10_000,
});

export const tlsFetchLMArena = (url, options = {}) => module.tlsFetch(url, options);
export const __setTlsFetchOverrideForTesting = module.__setTlsFetchOverrideForTesting;
