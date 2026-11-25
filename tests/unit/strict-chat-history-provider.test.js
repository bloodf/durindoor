import { describe, it, expect, vi } from "vitest";
import { normalizeStrictChatHistory } from "../../open-sse/utils/strictChatHistory.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { normalizeProviderSpecificData } from "../../src/lib/providerNormalization.js";
import { sanitizeProviderConnectionForClient } from "../../src/lib/providers/sanitizeProviderConnectionForClient.js";

const provider = "openai-compatible-test";
const history = [{ role: "user", content: "one" }, { role: "user", content: "" }, { role: "assistant", content: "two" }];
const repaired = [{ role: "user", content: "one\n " }, { role: "assistant", content: "two" }];

describe("strict chat history for custom connections", () => {
  it("preserves valid turns and merges consecutive text without dropping empty content", () => {
    const valid = [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }];
    expect(normalizeStrictChatHistory(valid)).toEqual(valid);
    expect(normalizeStrictChatHistory(history)).toEqual(repaired);
    expect(normalizeStrictChatHistory([{ role: "assistant", content: "" }, { role: "assistant", content: "x" }])).toEqual([{ role: "assistant", content: " \nx" }]);
  });
  it("leaves tools, multimodal content and unknown fields untouched", () => {
    for (const messages of [
      [{ role: "assistant", tool_calls: [{ id: "a" }], content: null }, { role: "tool", tool_call_id: "wrong", content: "result" }],
      [{ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AA" } }] }, ...history],
      [{ role: "user", content: "private", name: "client" }, ...history]
    ]) expect(normalizeStrictChatHistory(messages)).toBe(messages);
  });
  it("persists only a boolean opt-in and exposes it on the intended connection", () => {
    const data = normalizeProviderSpecificData(provider, {}, { strictChatHistory: true });
    expect(data.strictChatHistory).toBe(true);
    expect(sanitizeProviderConnectionForClient({ provider, providerSpecificData: data }).providerSpecificData.strictChatHistory).toBe(true);
    expect(normalizeProviderSpecificData(provider, {}, { strictChatHistory: "true" }).strictChatHistory).toBe(false);
    expect(normalizeProviderSpecificData("openai", {}, { strictChatHistory: true }).strictChatHistory).toBe(false);
  });
  it.each([[provider, true, repaired], [provider, false, history], ["openai-compatible-responses-test", true, history], ["anthropic-compatible-test", true, history], ["openai", true, history]])("sends the expected body for %s opt-in %s", async (id, enabled, expected) => {
    const fetcher = vi.fn(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
    const executor = new DefaultExecutor(id);
    await executor.execute({ model: "test", body: { model: "test", messages: structuredClone(history) }, stream: false, credentials: { apiKey: "mock", providerSpecificData: { baseUrl: "https://example.invalid/v1", strictChatHistory: enabled } }, directFetch: fetcher });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ model: "test", messages: expected, stream: false });
  });
});
