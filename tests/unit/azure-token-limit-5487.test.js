import { afterEach, describe, expect, it, vi } from "vitest";
import { AzureExecutor } from "../../open-sse/executors/azure.js";
import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: vi.fn() }));
afterEach(() => vi.resetAllMocks());
const credentials = { apiKey: "test", providerSpecificData: { azureEndpoint: "https://azure.example", deployment: "one" } };
const rejected = (param) => Response.json({ error: { code: "unsupported_parameter", param, message: `Unsupported parameter: '${param}'` } }, { status: 400 });
const ok = () => Response.json({ choices: [] });
const sent = () => proxyAwareFetch.mock.calls.map(([, options]) => JSON.parse(options.body));
const run = (executor, body, extra = {}) => executor.execute({ model: "legacy", body, stream: false, credentials, ...extra });

describe("Azure deployment token-limit negotiation", () => {
  it("retries an explicit rejection without losing the limit and caches by deployment", async () => {
    const executor = new AzureExecutor();
    proxyAwareFetch.mockResolvedValueOnce(rejected("max_tokens")).mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok());
    const body = { max_tokens: 42 };
    expect((await run(executor, body)).response.status).toBe(200);
    await run(executor, { max_tokens: 21 });
    await run(executor, { max_tokens: 9 }, { credentials: { ...credentials, providerSpecificData: { ...credentials.providerSpecificData, deployment: "two" } } });
    expect(sent()).toEqual([{ max_tokens: 42 }, { max_completion_tokens: 42 }, { max_completion_tokens: 21 }, { max_tokens: 9 }]);
    expect(body).toEqual({ max_tokens: 42 });
  });
  it("does not learn from a failed retry and passes unrelated errors through", async () => {
    const executor = new AzureExecutor();
    proxyAwareFetch.mockResolvedValueOnce(rejected("max_tokens")).mockResolvedValueOnce(Response.json({}, { status: 403 })).mockResolvedValueOnce(ok());
    expect((await run(executor, { max_tokens: 4 })).response.status).toBe(403);
    await run(executor, { max_tokens: 5 });
    expect(sent()).toEqual([{ max_tokens: 4 }, { max_completion_tokens: 4 }, { max_tokens: 5 }]);
    proxyAwareFetch.mockReset().mockResolvedValueOnce(Response.json({ error: { code: "other", param: "max_tokens" } }, { status: 400 }));
    expect((await run(executor, { max_tokens: 6 })).response.status).toBe(400);
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
  });
  it("forgets a stale preference and respects an explicit modern limit", async () => {
    const executor = new AzureExecutor();
    proxyAwareFetch.mockResolvedValueOnce(rejected("max_tokens")).mockResolvedValueOnce(ok()).mockResolvedValueOnce(rejected("max_completion_tokens")).mockResolvedValueOnce(ok());
    await run(executor, { max_tokens: 1 });
    expect((await run(executor, { max_completion_tokens: 2 })).response.status).toBe(400);
    await run(executor, { max_tokens: 3 });
    expect(sent()).toEqual([{ max_tokens: 1 }, { max_completion_tokens: 1 }, { max_completion_tokens: 2 }, { max_tokens: 3 }]);
  });
  it("honors the model's existing modern default and returns unrelated quota errors", async () => {
    proxyAwareFetch.mockResolvedValueOnce(Response.json({ error: { message: "quota" } }, { status: 429 }));
    const executor = new AzureExecutor();
    executor.config = { ...executor.config, retry: { 429: { attempts: 0 } } };
    const result = await run(executor, { max_tokens: 7 }, { model: "gpt-5" });
    expect(result.response.status).toBe(429);
    expect(sent()).toEqual([{ max_completion_tokens: 7 }]);
  });
  it("bounds retries and preserves explicit completion limits, including zero", async () => {
    const executor = new AzureExecutor();
    proxyAwareFetch.mockResolvedValueOnce(rejected("max_tokens")).mockResolvedValueOnce(rejected("max_completion_tokens"));
    const result = await run(executor, { max_tokens: 7, max_completion_tokens: 0 });
    expect(result.response.status).toBe(400);
    expect(sent()).toEqual([{ max_tokens: 7 }, { max_completion_tokens: 0 }]);
  });
  it("does not retry after the caller cancels", async () => {
    const controller = new AbortController();
    proxyAwareFetch.mockImplementationOnce(async () => {
      controller.abort();
      return rejected("max_tokens");
    });
    await expect(run(new AzureExecutor(), { max_tokens: 7 }, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
  });
  it.each([
    { maxTransportAttempts: 1 },
    { skipRules: [{ provider: "azure", match: { status: 400, contains: "max_tokens" }, action: "skip" }] },
  ])("honors request-level retry policy %j", async (requestPolicy) => {
    proxyAwareFetch.mockResolvedValueOnce(rejected("max_tokens"));
    const result = await run(new AzureExecutor(), { max_tokens: 7 }, { requestPolicy });
    expect(result.response.status).toBe(400);
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
  });
});
