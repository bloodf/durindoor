import { describe, expect, it, vi } from "vitest";
import { invalidClassifierVerdict } from "../../open-sse/handlers/chatCore/classifierVerdict.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { getModelInfoCore } from "../../open-sse/services/model.js";
import { getComboModelsFromData } from "../../open-sse/services/combo.js";
import { getModelUpstreamId } from "../../open-sse/config/providerModels.js";

const body = { stream: false, system: "You are a security monitor", stop_sequences: ["</block>"] };
const response = (text) => ({ type: "message", content: [{ type: "text", text }] });
describe("Claude auto mode fallback", () => {
  it.each(["<block>yes</block>", "<block>no</block>"])("accepts %s", (text) => {
    expect(invalidClassifierVerdict(FORMATS.CLAUDE, body, response(text))).toBe(false);
  });
  it.each(["allow", "", "<block>no", "<block>no</block> extra"])("rejects malformed %s", (text) => {
    expect(invalidClassifierVerdict(FORMATS.CLAUDE, body, response(text))).toBe(true);
  });
  it("keeps exact aliases and combos ahead of the suffix fallback", async () => {
    const aliases = { "agent[1m]": "cx/exact", agent: "cx/base" };
    expect((await getModelInfoCore("agent[1m]", aliases)).model).toBe("exact");
    expect((await getModelInfoCore("agent[1M]", aliases)).model).toBe("base");
    const combos = [{ name: "agent[1m]", models: ["exact"] }, { name: "agent", models: ["base"] }];
    expect(getComboModelsFromData("agent[1m]", combos)).toEqual(["exact"]);
    expect(getComboModelsFromData("agent[1M]", combos)).toEqual(["base"]);
    expect(getModelUpstreamId("cx", "some-model-1m")).toBe("some-model");
    expect(getModelUpstreamId("cx", "some-model[preview]")).toBe("some-model[preview]");
  });
});

vi.mock("@/lib/usageDb.js", () => ({ appendRequestLog: vi.fn(async () => {}), saveRequestDetail: vi.fn(async () => {}), saveRequestUsage: vi.fn(async () => {}) }));

const { handleForcedSSEToJson } = await import("../../open-sse/handlers/chatCore/sseToJsonHandler.js");
it.each([["<block>yes</block>", 200], ["garbage", 502]])("validates forced SSE verdict %s", async (text, status) => {
  const chunk = { id: "chatcmpl-test", model: "gpt", choices: [{ index: 0, delta: { content: text }, finish_reason: "stop" }] };
  const providerResponse = new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
  const result = await handleForcedSSEToJson({ providerResponse, sourceFormat: FORMATS.CLAUDE, targetFormat: FORMATS.OPENAI, provider: "openai", model: "gpt", body, stream: false, requestStartTime: Date.now(), trackDone: vi.fn(), appendLog: vi.fn(), clientRawRequest: { endpoint: "/v1/messages" } });
  expect(result.response.status).toBe(status);
  if (status === 200) expect((await result.response.json()).content).toEqual([{ type: "text", text }]);
});

const { handleNonStreamingResponse } = await import("../../open-sse/handlers/chatCore/nonStreamingHandler.js");
it.each([["<block>no</block>", 200], ["allow", 502]])("validates JSON verdict %s", async (text, status) => {
  const completion = { id: "chatcmpl-test", model: "gpt", choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } };
  const result = await handleNonStreamingResponse({ providerResponse: new Response(JSON.stringify(completion), { headers: { "content-type": "application/json" } }), provider: "openai", model: "gpt", body, sourceFormat: FORMATS.CLAUDE, targetFormat: FORMATS.OPENAI, stream: false, requestStartTime: Date.now(), reqLogger: { logProviderResponse: vi.fn(), logConvertedResponse: vi.fn() }, trackDone: vi.fn(), appendLog: vi.fn() });
  expect(result.response.status).toBe(status);
  if (status === 200) expect((await result.response.json()).content).toEqual([{ type: "text", text }]);
});
