// #2034: synthetic identities only; never resolve a real profile or contact a provider.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ provider: null, handler: null, calls: [] }));
vi.mock("@aws-sdk/credential-provider-ini", () => ({ fromIni: vi.fn(() => state.provider) }));
vi.mock("@aws-sdk/client-bedrock", async (original) => {
  const sdk = await original();
  return { ...sdk, BedrockClient: class extends sdk.BedrockClient {
    constructor(config) { super(config); state.handler = config.requestHandler; }
  } };
});
vi.mock("../../open-sse/utils/proxyFetch.js", async (original) => ({
  ...(await original()),
  proxyAwareFetch: vi.fn(async (url, init, route) => {
    state.calls.push({ url, init, route });
    return new Response(JSON.stringify(url.includes("foundation-models") ?
      { modelSummaries: [] } : { inferenceProfileSummaries: [] }),
    { headers: { "content-type": "application/json" } });
  }),
}));
const { fromIni } = await import("@aws-sdk/credential-provider-ini");
const { discoverBedrockModels } = await import("../../open-sse/services/providerParity/native-bedrock-discovery/index.js");
const profile = (data = {}) => ({ providerSpecificData: { profile: "synthetic-only", ...data } });
const proxy = { connectionProxyEnabled: true, connectionProxyUrl: "http://synthetic-proxy.test:8080" };
const direct = { oauthProxy: { mode: "direct" } };
beforeEach(() => {
  vi.clearAllMocks(); state.calls = []; state.handler = null;
  state.provider = vi.fn(async () => ({ accessKeyId: "AKIASYNTHETICONLY", secretAccessKey: "synthetic-secret" }));
  vi.stubEnv("AWS_EC2_METADATA_DISABLED", "true");
  vi.stubEnv("AWS_CONFIG_FILE", "/nonexistent/synthetic-profile-config");
  vi.stubEnv("AWS_SHARED_CREDENTIALS_FILE", "/nonexistent/synthetic-profile-credentials");
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
it.each([
  [proxy, null], [{ vercelRelayUrl: "https://synthetic-relay.test" }, null],
  [{ oauthProxy: { mode: "strict-pool", poolId: "synthetic-pool" } }, { strictProxy: false }],
  [{ strictProxy: true }, null], [{}, proxy], [{}, { vercelRelayUrl: "https://synthetic-relay.test" }],
  [{ ...proxy, connectionNoProxy: "amazonaws.com", strictProxy: true }, null],
])("refuses bound profile routes before fromIni, provider or transport: %j", async (data, options) => {
  const callback = vi.fn();
  await expect(discoverBedrockModels({ credentials: profile(data), proxyOptions: options, fetch: callback }))
    .rejects.toMatchObject({ kind: "config", code: "ProfileRouteUnsupported" });
  expect(fromIni).not.toHaveBeenCalled(); expect(state.provider).not.toHaveBeenCalled();
  expect(callback).not.toHaveBeenCalled(); expect(state.calls).toHaveLength(0);
});
it("uses merged durable direct selection and real SigV4 without ambient bearer fallback", async () => {
  vi.stubEnv("AWS_BEARER_TOKEN_BEDROCK", "synthetic-ambient-bearer");
  await expect(discoverBedrockModels({ credentials: profile({ ...proxy, ...direct }), proxyOptions: proxy }))
    .resolves.toMatchObject({ mode: "profile", models: [] });
  expect(fromIni).toHaveBeenCalledWith({ profile: "synthetic-only" });
  expect(state.calls).toHaveLength(2);
  expect(state.calls[0].init.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 /);
});
it("refuses an environment-selected proxy before profile construction", async () => {
  vi.stubEnv("HTTPS_PROXY", "http://synthetic-env.test:8080"); vi.stubEnv("NO_PROXY", "");
  await expect(discoverBedrockModels({ credentials: profile() })).rejects.toMatchObject({ code: "ProfileRouteUnsupported" });
  expect(fromIni).not.toHaveBeenCalled();
});
it.each(["static", "bearer"])("keeps %s identities and selected proxies isolated across two accounts", async (mode) => {
  for (const account of ["A", "B"]) {
    const credentials = { apiKey: `synthetic-secret-${account}`, providerSpecificData: {
      ...proxy, connectionProxyUrl: `http://proxy-${account}.test:8080`,
      ...(mode === "static" ? { accessKeyId: `AKIASYNTHETIC${account}` } : {}),
    } };
    await discoverBedrockModels({ credentials });
    const call = state.calls.at(-1);
    expect(call.route.connectionProxyUrl).toBe(`http://proxy-${account}.test:8080`);
    expect(new Headers(call.init.headers).get("authorization")).toContain(mode === "static" ? `Credential=AKIASYNTHETIC${account}/` : `Bearer synthetic-secret-${account}`);
  }
  expect(fromIni).not.toHaveBeenCalled();
});
it.each(["sts.amazonaws.com", "portal.sso.us-west-2.amazonaws.com", "oidc.us-west-2.amazonaws.com", "custom.test"])(
  "refuses signed forwarding to %s through the action handler", async (hostname) => {
    const controller = new AbortController();
    state.provider = vi.fn(() => new Promise(() => {}));
    const pending = discoverBedrockModels({ credentials: profile(direct), signal: controller.signal });
    const settled = pending.catch((error) => error);
    try {
      await expect(state.handler.handle({ protocol: "https:", hostname, path: "/", headers: { authorization: "synthetic-signed-header" } }))
        .rejects.toMatchObject({ code: "OriginRefused" });
      expect(state.calls).toHaveLength(0);
    } finally {
      controller.abort();
      await settled;
    }
  });
it("supports a direct-profile callback transport", async () => {
  const callback = vi.fn(async (url) => new Response(JSON.stringify(url.includes("foundation-models") ?
    { modelSummaries: [] } : { inferenceProfileSummaries: [] })));
  await discoverBedrockModels({ credentials: profile(direct), fetch: callback });
  expect(callback).toHaveBeenCalledTimes(2); expect(state.calls).toHaveLength(0);
});
it("bounds caller wait without claiming to cancel a pending direct profile chain", async () => {
  state.provider = vi.fn(() => new Promise(() => {}));
  await expect(discoverBedrockModels({ credentials: profile(direct), timeoutMs: 20 }))
    .rejects.toMatchObject({ kind: "timeout" });
  expect(state.provider).toHaveBeenCalled(); expect(state.calls).toHaveLength(0);
});
it("handles caller abort during direct profile resolution", async () => {
  const controller = new AbortController();
  state.provider = vi.fn(() => { controller.abort(new Error("synthetic-sensitive-abort")); return new Promise(() => {}); });
  await expect(discoverBedrockModels({ credentials: profile(direct), signal: controller.signal }))
    .rejects.toMatchObject({ kind: "aborted", message: "Bedrock model discovery was cancelled" });
  expect(state.calls).toHaveLength(0);
});
it("redacts direct profile provider rejection", async () => {
  state.provider = vi.fn(async () => { throw Object.assign(new Error("synthetic-sensitive-provider-output"), { name: "CredentialsProviderError" }); });
  const error = await discoverBedrockModels({ credentials: profile(direct) }).catch((error) => error);
  expect(error).toMatchObject({ kind: "auth", code: "CredentialsProviderError" });
  expect(JSON.stringify(error) + error.message).not.toContain("synthetic-sensitive");
  expect(error.cause).toBeUndefined(); expect(state.calls).toHaveLength(0);
});
