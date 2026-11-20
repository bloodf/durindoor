import { afterEach, describe, expect, it, vi } from "vitest";

import { AzureExecutor } from "../../open-sse/executors/azure.js";
import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";

// Upstream decolua/9router#2809 — Azure GPT-5/GPT-6 and o-series deployments
// reject `max_tokens`, a custom `temperature`, and `reasoning_effort` next to
// tools on /chat/completions.
//
// The fork keeps the family evidence local: the deployment identifier this
// executor actually calls. Azure deployment names are operator-chosen and
// opaque, so an unrecognized name must not be guessed into a family, and a
// deployment serving another family keeps the existing parameter contract.

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: vi.fn() }));
afterEach(() => vi.resetAllMocks());

const AZURE_PROVIDER_DATA = {
  azureEndpoint: "https://example-resource.openai.azure.com",
  apiVersion: "2025-04-01-preview",
};
const credentials = (deployment) => ({
  apiKey: "fixture-key",
  providerSpecificData: { ...AZURE_PROVIDER_DATA, ...(deployment ? { deployment } : {}) },
});
const rejected = (param) => Response.json({
  error: { code: "unsupported_parameter", param, message: `Unsupported parameter: '${param}'` },
}, { status: 400 });
const ok = () => Response.json({ choices: [] });
const sent = () => proxyAwareFetch.mock.calls.map(([, options]) => JSON.parse(options.body));

const TOOLS = [{ type: "function", function: { name: "get_weather" } }];
const MESSAGES = [{ role: "user", content: "Hello" }];

describe("Azure GPT-5-family request normalization (upstream #2809)", () => {
  it("normalizes a GPT-5 deployment named by the connection and preserves tools", () => {
    const executor = new AzureExecutor();
    const body = Object.freeze({
      max_tokens: 4096,
      temperature: 0.2,
      reasoning_effort: "medium",
      tools: Object.freeze([...TOOLS]),
      tool_choice: "auto",
      messages: Object.freeze([...MESSAGES]),
    });

    const result = executor.transformRequest("chat", body, false, credentials("gpt-5-prod"));

    expect(result).toEqual({
      max_completion_tokens: 4096,
      tools: TOOLS,
      tool_choice: "auto",
      messages: MESSAGES,
    });
    // The caller's body is never mutated.
    expect(body).toHaveProperty("max_tokens", 4096);
    expect(body).toHaveProperty("temperature", 0.2);
    expect(body).toHaveProperty("reasoning_effort", "medium");
  });

  it("keeps an explicit max_completion_tokens and drops only the legacy spelling", () => {
    const executor = new AzureExecutor();

    const result = executor.transformRequest("chat", {
      max_tokens: 1024,
      max_completion_tokens: 8192,
    }, false, credentials("gpt-5-prod"));

    expect(result).toEqual({ max_completion_tokens: 8192 });
  });

  it("drops a custom temperature but keeps the accepted default", () => {
    const executor = new AzureExecutor();

    expect(
      executor.transformRequest("chat", { temperature: 0.2 }, false, credentials("gpt-5-prod")),
    ).toEqual({});
    expect(
      executor.transformRequest("chat", { temperature: 1 }, false, credentials("gpt-5-prod")),
    ).toEqual({ temperature: 1 });
  });

  it("uses the requested model as the deployment when the connection names none", () => {
    const executor = new AzureExecutor();

    const result = executor.transformRequest("gpt-5", {
      max_tokens: 2048,
      temperature: 0.2,
    }, false, credentials());

    expect(result).toEqual({ max_completion_tokens: 2048 });
  });

  it("leaves another model family untouched", () => {
    const executor = new AzureExecutor();
    const body = {
      max_tokens: 1024,
      temperature: 0.2,
      reasoning_effort: "none",
      tools: TOOLS,
      tool_choice: "required",
    };

    const result = executor.transformRequest("gpt-4o", body, false, credentials("gpt-4o-deploy"));

    expect(result).toEqual(body);
  });

  it("is a no-op when the deployment name does not establish the family", () => {
    const executor = new AzureExecutor();
    const body = {
      max_tokens: 1024,
      temperature: 0.2,
      reasoning_effort: "medium",
      tools: TOOLS,
    };

    const result = executor.transformRequest("prod-chat", body, false, credentials("prod-chat"));

    expect(result).toEqual(body);
  });

  it("keeps the negotiated token-limit retry for a GPT-5 deployment", async () => {
    const executor = new AzureExecutor();
    proxyAwareFetch.mockResolvedValueOnce(rejected("max_completion_tokens")).mockResolvedValueOnce(ok());

    const result = await executor.execute({
      model: "chat",
      body: { max_tokens: 42 },
      stream: false,
      credentials: credentials("gpt-5-prod"),
    });

    expect(result.response.status).toBe(200);
    // The family default is tried first; the measured rejection still wins.
    expect(sent()).toEqual([{ max_completion_tokens: 42 }, { max_tokens: 42 }]);

    // The negotiated spelling is remembered per deployment URL.
    proxyAwareFetch.mockResolvedValueOnce(ok());
    await executor.execute({
      model: "chat",
      body: { max_tokens: 42 },
      stream: false,
      credentials: credentials("gpt-5-prod"),
    });
    expect(sent()[2]).toEqual({ max_tokens: 42 });
  });
});
