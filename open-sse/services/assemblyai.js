import { PROVIDERS } from "../config/providers.js";

/** Probe AssemblyAI without submitting audio or mistaking service failures for bad keys. */
export async function probeAssemblyAiKey(apiKey, fetcher) {
  const response = await fetcher(PROVIDERS.assemblyai.validateUrl, { headers: { Authorization: apiKey } });
  if (response.ok) return { valid: true, error: null };
  if (response.status === 401 || response.status === 403) return { valid: false, error: "Invalid API key" };
  return { valid: false, error: `Unable to verify API key (AssemblyAI returned ${response.status})` };
}
