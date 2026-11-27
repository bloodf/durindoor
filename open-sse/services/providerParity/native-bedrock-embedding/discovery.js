// Source: OmniRoute services/bedrock.ts + config/bedrock.ts at the pinned commit.
// Discovery is descriptive: it never expands the embedding execution allowlist.
import { isString } from "../../../../src/shared/utils/typeChecks.js";
import { readBoundedResponseText } from "../../../utils/error.js";
import { proxyAwareFetch } from "../../../utils/proxyFetch.js";
import { resolveCredentialProxyOptions } from "../../oauthCredentialManager.js";
import { bedrockRegion, BEDROCK_EMBEDDING_MODELS } from "./config.js";
import { boundedFetch, bedrockToken, bedrockHeaders, redirectState, discard } from "./http.js";
export async function discoverBedrockEmbeddingModels({ credentials, signal, fetch: send, timeoutMs = 30000 }) {
  const token = bedrockToken(credentials);
  if (!token || credentials?.providerSpecificData?.profile || credentials?.providerSpecificData?.accessKeyId || credentials?.sessionToken) throw new Error("Bedrock bearer API key required");
  const region = bedrockRegion(credentials);
  const origin = `https://bedrock.${region}.amazonaws.com`;
  const end = Date.now() + Math.min(30000, Math.max(1, timeoutMs));
  const transport = send ?? ((url, init) => proxyAwareFetch(url, init, resolveCredentialProxyOptions(credentials)));
  async function get(path) {
    if (signal?.aborted || Date.now() >= end) throw new Error("Bedrock discovery ended");
    let response;
    try { response = await boundedFetch(transport, origin + path, { method: "GET", headers: { Accept: "application/json", ...bedrockHeaders(token) }, redirect: "manual" }, { signal, timeoutMs: end - Date.now() }); }
    catch { throw new Error("Bedrock discovery transport unavailable"); }
    if (redirectState(response, origin) || !response.ok) { discard(response); throw new Error("Bedrock discovery refused"); }
    try {
      return JSON.parse(await readBoundedResponseText(response, { signal, timeoutMs: Math.max(1, end - Date.now()), maxBytes: 2 * 1024 * 1024, throwOnTimeout: true }));
    } catch { throw new Error("Bedrock discovery answer unavailable"); }
  }
  const foundation = await get("/foundation-models?byOutputModality=TEXT");
  if (!Array.isArray(foundation?.modelSummaries)) throw new Error("Invalid Bedrock discovery list");
  const ids = new Set(foundation.modelSummaries.map(row => row?.modelId));
  const seen = new Set();
  let nextToken;
  for (let page = 0; page < 10; page++) {
    const params = new URLSearchParams({ maxResults: "100", typeEquals: "SYSTEM_DEFINED" });
    if (nextToken) params.set("nextToken", nextToken);
    const profiles = await get(`/inference-profiles?${params}`);
    if (!Array.isArray(profiles?.inferenceProfileSummaries)) throw new Error("Invalid Bedrock profiles list");
    for (const profile of profiles.inferenceProfileSummaries) {
      for (const row of profile?.models ?? []) {
        if (isString(row?.modelArn)) ids.add(row.modelArn.split(":foundation-model/")[1]);
      }
    }
    nextToken = profiles.nextToken;
    if (!nextToken) return BEDROCK_EMBEDDING_MODELS.filter(model => ids.has(model.id));
    if (!isString(nextToken) || nextToken.length > 4096 || seen.has(nextToken)) throw new Error("Invalid Bedrock pagination");
    seen.add(nextToken);
  }
  throw new Error("Bedrock discovery page limit exceeded");
}
