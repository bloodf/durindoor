import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: vi.fn() }));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { getUsageForProvider } from "../../open-sse/services/usage.js";

describe("Kimi regional usage routing", () => {
  afterEach(() => vi.resetAllMocks());

  it.each([
    ["kimi-ai", undefined, "https://api.kimi.ai/coding/v1/usages"],
    ["kimi-coding", undefined, "https://api.kimi.com/coding/v1/usages"],
    ["kimi-coding", "https://api.kimi.ai/coding/v1/messages", "https://api.kimi.ai/coding/v1/usages"],
    ["kimi-ai", "https://api.kimi.ai.evil.example/", "https://api.kimi.ai/coding/v1/usages"],
  ])("routes %s usage with base %s", async (provider, baseUrl, expected) => {
    proxyAwareFetch.mockResolvedValueOnce(Response.json({ usage: { limit: 10, used: 2 } }));
    const result = await getUsageForProvider({ provider, accessToken: "test-token", providerSpecificData: { baseUrl } });
    expect(proxyAwareFetch).toHaveBeenCalledOnce();
    expect(String(proxyAwareFetch.mock.calls[0][0])).toBe(expected);
    expect(result.quotas.Weekly).toMatchObject({ used: 2, total: 10 });
  });
});

import { getExecutor } from "../../open-sse/executors/index.js";
import { normalizeKimiRequest } from "../../open-sse/executors/kimiParity.js";
async function sendKimi(format, body, model = "k3.1-pro") {
  proxyAwareFetch.mockResolvedValueOnce(Response.json({ id: "response", choices: [] }));
  const urls = { openai: "https://api.kimi.ai/coding/v1/chat/completions", claude: "https://api.kimi.com/coding/v1/messages", "openai-responses": "https://api.kimi.com/coding/v1/responses" };
  const executor = getExecutor(format === "openai" ? "kimi-ai" : "kimi-coding-apikey");
  await executor.execute({ model, body, stream: false, credentials: { apiKey: "test", runtimeTransport: { format, baseUrl: urls[format], auth: { combined: true, header: "Authorization", scheme: "bearer" } } }, requestContext: {} });
  const [url, options] = proxyAwareFetch.mock.calls.at(-1);
  expect(String(url)).toBe(urls[format]);
  return JSON.parse(options.body);
}
describe("Kimi Coding wire compatibility", () => {
  afterEach(() => vi.resetAllMocks());
  it("normalizes Chat effort, links, schema references and temperature", async () => {
    const wire = await sendKimi("openai", { model: "kimi-k3.1-pro", reasoning_effort: "medium", temperature: 0.4, messages: [{ role: "assistant", content: null, tool_calls: [{ id: "call-1", type: "function", function: { name: "lookup", arguments: "{}" } }] }, { role: "tool", content: "done" }], tools: [{ type: "function", function: { name: "lookup", parameters: { $defs: { word: { type: "string" } }, properties: { q: { $ref: "#/$defs/word" } } } } }] });
    expect(wire.model).toBe("k3.1-pro");
    expect(wire.thinking).toEqual({ type: "enabled", effort: "high", keep: "all" });
    expect(wire.temperature).toBeUndefined();
    expect(wire.messages[1]).toMatchObject({ tool_call_id: "call-1", name: "lookup" });
    expect(wire.messages[0].reasoning_content).toBe("[reasoning unavailable]");
    expect(wire.tools[0].function.parameters).toEqual({ type: "object", properties: { q: { type: "string" } } });
  });
  it("keeps ambiguous tool results unlinked and preserves disabled temperature", async () => {
    const wire = await sendKimi("openai", { model: "k3.1-pro", thinking: { type: "disabled" }, temperature: 0.6, messages: [{ role: "assistant", tool_calls: [{ id: "a" }, { id: "b" }] }, { role: "tool", content: "x" }] });
    expect(wire.messages[1].tool_call_id).toBeUndefined();
    expect(wire.temperature).toBe(0.6);
  });
  it("adds Anthropic thinking context and backfills tool-use history", async () => {
    const wire = await sendKimi("claude", { model: "k3.1-pro", max_tokens: 1000, messages: [{ role: "assistant", content: [{ type: "tool_use", id: "x", name: "lookup", input: {} }] }] });
    expect(wire.output_config.effort).toBe("max");
    expect(wire.context_management.edits).toContainEqual({ type: "clear_thinking_20251015", keep: "all" });
    expect(wire.messages[0].content[0]).toEqual({ type: "thinking", thinking: "" });
  });
  it("removes only thinking context edits when Anthropic thinking is disabled", async () => {
    const wire = await sendKimi("claude", { model: "k3.1-pro", thinking: { type: "disabled" }, context_management: { edits: [{ type: "clear_thinking_20251015" }, { type: "clear_tool_uses_20250919" }] }, messages: [{ role: "user", content: "hello" }] });
    expect(wire.thinking).toEqual({ type: "disabled" });
    expect(wire.context_management.edits).toEqual([{ type: "clear_tool_uses_20250919" }]);
  });
  it.each([["xhigh", "max"], ["minimum", "low"], ["unknown", "unknown"]])("maps K3.1 effort %s to %s", async (effort, expected) => {
    const wire = await sendKimi("openai", { model: "k3.1-pro", reasoning_effort: effort, messages: [{ role: "user", content: "hello" }] });
    expect(wire.thinking.effort).toBe(expected);
  });
  it("normalizes Responses tool schemas and aliases", async () => {
    const wire = await sendKimi("openai-responses", { model: "kimi-k2.8-preview", input: [], tools: [{ type: "function", name: "lookup", parameters: { definitions: { q: { type: "string" } }, properties: { q: { $ref: "#/definitions/q" } } } }] }, "kimi-k2.8-preview");
    expect(wire.model).toBe("kimi-for-coding");
    expect(wire.tools[0].parameters).toEqual({ type: "object", properties: { q: { type: "string" } } });
  });
  it("exposes wallet values in minor units", async () => {
    proxyAwareFetch.mockResolvedValueOnce(Response.json({ boosterWallet: { status: "STATUS_ACTIVE", balance: { type: "BOOSTER", amountLeft: "1500000" }, monthlyUsed: { currency: "usd", priceInCents: 7 }, monthlyChargeLimitEnabled: true, monthlyChargeLimit: { currency: "USD", priceInCents: 100 } } }));
    const result = await getUsageForProvider({ provider: "kimi-ai", accessToken: "test" });
    expect(result.billing).toMatchObject({ currency: "USD", extraUsageStatus: "enabled", extraCreditsMinorUnits: 2, monthlyUsedMinorUnits: 7, monthlyLimitMinorUnits: 100, monthlyLimitEnabled: true });
  });
});

describe("Kimi tool schema budgets", () => {
  const referenceSchema = () => ({
    $defs: { word: { type: "string" } },
    properties: { q: { $ref: "#/$defs/word" } },
  });
  const limits = { work: 1_000, bytes: 1_000, depth: 16 };

  it("shares work across tools, legacy functions, and Responses input tool lists", () => {
    const original = referenceSchema();
    const body = {
      tools: [{ function: { parameters: {} } }],
      functions: [{ parameters: {} }],
      input: [{ type: "additional_tools", tools: [{ parameters: original }] }],
    };

    normalizeKimiRequest(body, "", "openai-responses", { ...limits, work: 9 });

    expect(body.tools[0].function.parameters).toEqual({ type: "object" });
    expect(body.functions[0].parameters).toEqual({ type: "object" });
    expect(body.input[0].tools[0].parameters).toBe(original);
    expect(original).toEqual(referenceSchema());
  });

  it.each([
    { bytes: 75 },
    { depth: 4 },
  ])("keeps the original schema on exhaustion with %j", (limit) => {
    const original = referenceSchema();
    const later = {};
    const body = { tools: [{ children: [{ parameters: original }] }, { parameters: later }] };

    normalizeKimiRequest(body, "", "openai", { ...limits, ...limit });

    expect(body.tools[0].children[0].parameters).toBe(original);
    expect(original).toEqual(referenceSchema());
    expect(body.tools[1].parameters).toBe(later);
  });

  it("preserves unresolved refs and applies sibling overrides", () => {
    const parameters = referenceSchema();
    parameters.properties.q.type = "number";
    parameters.properties.external = { $ref: "external.json" };
    const body = { tools: [{ parameters }] };

    normalizeKimiRequest(body, "", "openai");

    expect(body.tools[0].parameters).toEqual({
      $defs: { word: { type: "string" } },
      type: "object",
      properties: { q: { type: "number" }, external: { $ref: "external.json" } },
    });
  });
});
