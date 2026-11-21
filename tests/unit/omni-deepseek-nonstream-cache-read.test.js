import { describe, expect, it, vi } from "vitest";
import { extractUsageFromResponse } from "../../open-sse/handlers/chatCore/requestDetail.js";
import { handleNonStreamingResponse, translateNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}), saveRequestDetail: vi.fn(async () => {}), saveRequestUsage: vi.fn(async () => {}),
}));

const usage = { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 };
const extract = (extra) => extractUsageFromResponse({ usage: { ...usage, ...extra } });

describe("DeepSeek nonstream cache reads", () => {
  it("records the flat inclusive cache count without changing totals", () => {
    expect(extract({ prompt_cache_hit_tokens: 40 })).toMatchObject({ ...usage, cached_tokens: 40 });
  });

  it.each([0, 17])("retains nested cache precedence for %s", (cached_tokens) => {
    expect(extract({ prompt_cache_hit_tokens: 40, prompt_tokens_details: { cached_tokens } }).cached_tokens).toBe(cached_tokens);
  });

  it.each([undefined, null, -1, NaN, Infinity, "40", {}, false])("ignores invalid flat count %s", (value) => {
    expect(extract({ prompt_cache_hit_tokens: value })).toEqual(extract({}));
  });

  it("does not change exclusive cache accounting or Responses-shaped usage", () => {
    const exclusive = { cache_creation_input_tokens: 10 };
    expect(extract({ ...exclusive, prompt_cache_hit_tokens: 40 })).toEqual(extract(exclusive));
    const responses = { input_tokens: 100, output_tokens: 20, total_tokens: 120 };
    expect(extractUsageFromResponse({ usage: { ...responses, prompt_cache_hit_tokens: 40 } }))
      .toEqual(extractUsageFromResponse({ usage: responses }));
  });

  it("keeps JSON passthrough and Responses projection behavior", () => {
    const body = { id: "chatcmpl-test", object: "chat.completion", model: "deepseek", choices: [{ index: 0, message: { role: "assistant", content: "hello" }, finish_reason: "stop" }], usage: { ...usage, prompt_cache_hit_tokens: 40 } };
    expect(translateNonStreamingResponse(structuredClone(body), FORMATS.OPENAI, FORMATS.OPENAI).usage).toEqual(body.usage);
    const projected = translateNonStreamingResponse(structuredClone(body), FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES);
    expect(projected.usage).toMatchObject({ input_tokens: 100, output_tokens: 20, total_tokens: 120 });
  });

  it("dispatches a JSON response through nonstream usage extraction", async () => {
    const body = { id: "chatcmpl-test", object: "chat.completion", model: "deepseek", choices: [{ index: 0, message: { role: "assistant", content: "hello" }, finish_reason: "stop" }], usage: { ...usage, prompt_cache_hit_tokens: 40 } };
    const appendLog = vi.fn();
    const result = await handleNonStreamingResponse({
      providerResponse: new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } }),
      provider: "deepseek", model: "deepseek", sourceFormat: FORMATS.OPENAI, targetFormat: FORMATS.OPENAI,
      body: { messages: [] }, stream: false, requestStartTime: Date.now(),
      onRequestSuccess: vi.fn(), trackDone: vi.fn(), appendLog,
      reqLogger: { logProviderResponse: vi.fn(), logConvertedResponse: vi.fn() },
    });
    expect(result.success).toBe(true);
    expect(appendLog).toHaveBeenCalledWith(expect.objectContaining({ tokens: expect.objectContaining({ ...usage, cached_tokens: 40 }) }));
  });
});
