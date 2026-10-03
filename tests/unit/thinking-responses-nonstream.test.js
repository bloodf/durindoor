import { describe, expect, it, vi } from "vitest";
import { handleNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { isCoherentNonStreamingResponse } from "../../open-sse/utils/streamTerminal.js";
import { validateOutboundPayload } from "../../open-sse/translator/validate.js";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(() => Promise.resolve()),
  saveRequestDetail: vi.fn(() => Promise.resolve()),
  saveRequestUsage: vi.fn(() => Promise.resolve()),
}));

function providerResponse(body) {
  return { headers: new Map([["content-type", "application/json"]]), text: () => Promise.resolve(JSON.stringify(body)), status: 200, statusText: "OK" };
}
function options(body) {
  return {
    providerResponse: providerResponse(body), provider: "openai", model: "gpt-5.6-sol",
    sourceFormat: FORMATS.OPENAI_RESPONSES, targetFormat: FORMATS.OPENAI_RESPONSES,
    body: { model: "gpt-5.6-sol", input: "hi" }, stream: false, streamToClient: false,
    requestStartTime: Date.now(), reqLogger: { logProviderResponse: vi.fn(), logConvertedResponse: vi.fn() }, trackDone: vi.fn(), appendLog: vi.fn(),
  };
}
const response = (output) => ({ object: "response", id: "resp_1", model: "gpt-5.6-sol", status: "completed", output });

describe("non-streaming Responses native output", () => {
  it("accepts documented native text input but rejects scalar non-text input", () => {
    expect(validateOutboundPayload(FORMATS.OPENAI_RESPONSES, { model: "fixture-model", input: "fixture input" }).ok).toBe(true);
    expect(validateOutboundPayload(FORMATS.OPENAI_RESPONSES, { model: "fixture-model", input: 42 }).ok).toBe(false);
  });

  it.each([
    [{ type: "image_generation_call", result: "base64-image" }],
    [{ type: "computer_call", call_id: "call_1", action: "click" }],
    [{ type: "local_shell_call", call_id: "call_1", command: "pwd" }],
    [{ type: "apply_patch_call", call_id: "call_1", operation: "create_file" }],
    [{ type: "mcp_approval_request", id: "apr_1", name: "github" }],
    [{ type: "message", content: [{ type: "refusal", refusal: "cannot comply" }] }],
  ])("returns usable native output %#", async (output) => {
    const nativeResponse = response([output]);
    expect(isCoherentNonStreamingResponse(nativeResponse, FORMATS.OPENAI_RESPONSES)).toBe(true);
    const result = await handleNonStreamingResponse(options(nativeResponse));
    const responseText = await result.response.text();
    expect(result.success, responseText).toBe(true);
    expect(JSON.parse(responseText)).toEqual(nativeResponse);
  });

  it.each([
    [{ type: "image_generation_call" }],
    [{ type: "image_generation_call", result: null }],
    [{ type: "computer_call", call_id: "call_1" }],
    [{ type: "local_shell_call", command: "pwd" }],
    [{ type: "apply_patch_call", call_id: "call_1" }],
    [{ type: "mcp_approval_request", id: "apr_1" }],
    [{ type: "message", content: [{ type: "refusal", refusal: " " }] }],
  ])("rejects empty native output shell %#", async (output) => {
    const result = await handleNonStreamingResponse(options(response([output])));
    expect(result.success).toBe(false);
    expect(result.response.status).toBe(502);
  });

  it.each(["queued", "in_progress"])("returns credible %s acknowledgement", async (status) => {
    const acknowledgement = { object: "response", id: "resp_ack", model: "gpt-5.6-sol", status, output: [] };
    const result = await handleNonStreamingResponse(options(acknowledgement));
    expect(result.success).toBe(true);
    expect(await result.response.json()).toEqual(acknowledgement);
  });

  it("rejects queued acknowledgement without an ID", async () => {
    const result = await handleNonStreamingResponse(options({ object: "response", id: "", model: "gpt-5.6-sol", status: "queued" }));
    expect(result.success).toBe(false);
    expect(result.response.status).toBe(502);
  });

  it("keeps queued acknowledgement invalid for Codex", async () => {
    const args = options({ object: "response", id: "resp_ack", model: "gpt-5.6-sol", status: "queued" });
    args.targetFormat = FORMATS.CODEX;
    const result = await handleNonStreamingResponse(args);
    expect(result.success).toBe(false);
    expect(result.response.status).toBe(502);
  });
});
