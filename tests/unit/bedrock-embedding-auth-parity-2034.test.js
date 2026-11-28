import { describe, expect, it, vi } from "vitest";
import { createBedrockEmbeddingAdapter, discoverBedrockEmbeddingModels } from "../../open-sse/services/providerParity/native-bedrock-embedding/index.js";
const network = vi.hoisted(() => ({ calls: [] }));
vi.mock("../../open-sse/utils/proxyFetch.js", async importOriginal => ({
  ...(await importOriginal()),
  proxyAwareFetch: vi.fn(async (url, init, options) => {
    network.calls.push({ url, init, options });
    return Response.json({ embedding: Array(1024).fill(0.25) });
  }),
}));
const model = "amazon.titan-embed-text-v2:0";
const invoke = (fetch, credentials) => createBedrockEmbeddingAdapter({ fetch }).embed({ model, body: { input: "hello" }, credentials });
const answer = () => Response.json({ embedding: Array(1024).fill(0.25) });
describe("Bedrock embedding credential refusal #2034", () => {
  it("never sends the source-shaped AWS secret as Bearer", async () => {
    const send = vi.fn(async () => answer());
    const result = await invoke(send, { apiKey: "fake-aws-secret", providerSpecificData: { awsAccessKeyId: "fake-id" } });
    expect(send).not.toHaveBeenCalled();
    expect(result.status).toBe(400);
  });
});

const cues = ["accessKeyId", "awsAccessKeyId", "secretAccessKey", "awsSecretAccessKey", "sessionToken", "awsSessionToken", "profile", "awsProfile", "authMode", "credentialMode"];
describe("Bearer-only auth matrix and snapshots", () => {
  for (const field of cues) for (const value of ["fake-value", "", null, false]) {
    it(`refuses ${field}=${JSON.stringify(value)} at either storage level before invoke/discovery`, async () => {
      for (const nested of [false, true]) {
        const credentials = { apiKey: "fake-secret", ...(nested ? { providerSpecificData: { [field]: value } } : { [field]: value }) };
        const send = vi.fn(async () => answer());
        const result = await invoke(send, credentials);
        expect(result.status).toBe(400);
        expect(result.acceptedJob).toBeUndefined();
        expect(await result.response.text()).not.toContain("fake-secret");
        await expect(discoverBedrockEmbeddingModels({ credentials, fetch: send })).rejects.toThrow();
        expect(send).not.toHaveBeenCalled();
      }
    });
  }
  it.each([
    { providerSpecificData: { awsAccessKeyId: "fake-id" } },
    { providerSpecificData: { accessKeyId: "ASIA-fake" } },
    { apiKey: "fake-secret", sessionToken: "fake-session", providerSpecificData: { accessKeyId: "ASIA-fake" } },
    { apiKey: "opaque", providerSpecificData: { profile: "fake-profile", awsAccessKeyId: "conflict", accessKeyId: "other" } },
  ])("refuses incomplete, temporary and conflicting IAM: %j", async credentials => {
    const send = vi.fn();
    expect((await invoke(send, credentials)).status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });
  it("keeps opaque keys without format guesses and isolates concurrent connection snapshots", async () => {
    const calls = [];
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    const send = vi.fn(async (url, init) => { calls.push([url, init]); await pending; return answer(); });
    const first = { apiKey: "opaque AWS-looking value", providerSpecificData: { region: "eu-west-2", proxy: { host: "proxy-a" } } };
    const second = { accessToken: "other opaque value", providerSpecificData: { region: "us-west-2", proxy: { host: "proxy-b" } } };
    const a = invoke(send, first);
    const b = invoke(send, second);
    first.apiKey = "changed";
    first.providerSpecificData.region = "ap-south-1";
    release();
    expect((await a).success).toBe(true);
    expect((await b).success).toBe(true);
    expect(calls.map(([url, init]) => [new URL(url).hostname, init.headers.Authorization])).toEqual([
      ["bedrock-runtime.eu-west-2.amazonaws.com", "Bearer opaque AWS-looking value"],
      ["bedrock-runtime.us-west-2.amazonaws.com", "Bearer other opaque value"],
    ]);
  });
  it("does not expose an IAM secret through buildHeaders", () => {
    const adapter = createBedrockEmbeddingAdapter();
    expect(adapter.buildHeaders({ apiKey: "fake-secret", providerSpecificData: { awsAccessKeyId: "fake-id" } }).Authorization).not.toContain("fake-secret");
  });
});


describe("actual selected proxy boundary", () => {
  it("captures separate proxy/auth/region snapshots without environment proxy fallback", async () => {
    network.calls.length = 0;
    const adapter = createBedrockEmbeddingAdapter();
    for (const [suffix, region] of [["a", "eu-west-2"], ["b", "us-west-2"]]) {
      const credentials = { apiKey: `opaque-${suffix}`, providerSpecificData: {
        region, connectionProxyEnabled: true, connectionProxyUrl: `http://proxy-${suffix}.example:3128`,
      } };
      const pending = adapter.embed({ model, body: { input: "hello" }, credentials });
      credentials.providerSpecificData.connectionProxyUrl = "http://changed.example";
      expect((await pending).success).toBe(true);
    }
    expect(network.calls.map(call => [new URL(call.url).hostname, call.init.headers.Authorization,
      call.options.connectionProxyUrl, call.options.disableEnvProxy])).toEqual([
      ["bedrock-runtime.eu-west-2.amazonaws.com", "Bearer opaque-a", "http://proxy-a.example:3128", true],
      ["bedrock-runtime.us-west-2.amazonaws.com", "Bearer opaque-b", "http://proxy-b.example:3128", true],
    ]);
  });
});


it("refuses an uncloneable connection before transport and sanitizes it", async () => {
  const credentials = { apiKey: "fake-secret", providerSpecificData: { invalid: () => {} } };
  const send = vi.fn();
  const result = await invoke(send, credentials);
  expect(result.status).toBe(400);
  expect(await result.response.text()).not.toContain("fake-secret");
  await expect(discoverBedrockEmbeddingModels({ credentials, fetch: send })).rejects.toThrow("snapshot");
  expect(send).not.toHaveBeenCalled();
});
