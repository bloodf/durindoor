import { describe, expect, it } from "vitest";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";
import { ANTIGRAVITY_DEFAULT_SYSTEM } from "../../open-sse/config/appConstants.js";

const credentials = { projectId: "test-project", connectionId: "test-connection" };
const transform = (model, request) => new AntigravityExecutor().transformRequest(model, { request }, false, credentials).request;

describe("Antigravity Claude request shape", () => {
  it("retains supported fields and local tool configuration while omitting internal fields", () => {
    const request = transform("claude-sonnet-4-6", {
      contents: [{ role: "user", parts: [{ text: "hello" }] }],
      systemInstruction: { parts: [{ text: "Be concise" }] },
      generationConfig: { temperature: 0.5, maxOutputTokens: 1234 },
      tools: [{ functionDeclarations: [{ name: "lookup", parameters: { type: "object", properties: {} } }] }],
      toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["lookup"] } },
      sessionId: "12345", sessionMetadata: { source: "client" }, labels: { keep: "yes" }, cachedContent: "cache/1",
      internalMarker: "omit", messages: [{ role: "user", content: "omit" }],
    });
    expect(request.contents).toEqual([{ role: "user", parts: [{ text: "hello" }] }]);
    expect(request.systemInstruction.parts.map((part) => part.text)).toEqual([ANTIGRAVITY_DEFAULT_SYSTEM, "Be concise"]);
    expect(request.generationConfig).toMatchObject({ temperature: 0.5, maxOutputTokens: 1234 });
    expect(request.tools[0].functionDeclarations[0].name).toBe("lookup");
    expect(request.toolConfig.functionCallingConfig).toEqual({ mode: "ANY", allowedFunctionNames: ["lookup"] });
    expect(request.sessionId).not.toBe("12345");
    expect(request).toMatchObject({ sessionId: expect.stringMatching(/^-?\d+$/), sessionMetadata: { source: "client" }, labels: { keep: "yes" }, cachedContent: "cache/1" });
    expect(BigInt.asIntN(64, BigInt(request.sessionId)).toString()).toBe(request.sessionId);
    expect(request).not.toHaveProperty("internalMarker");
    expect(request).not.toHaveProperty("messages");
  });

  it("passes an incoming session id through unchanged without a credential to scope it", () => {
    const request = new AntigravityExecutor().transformRequest("claude-sonnet-4-6", { request: { contents: [{ role: "user", parts: [{ text: "hi" }] }], sessionId: "12345" } }, false, { projectId: "test-project" }).request;
    expect(request.sessionId).toBe("12345");
  });

  it("leaves non-Claude request fields and empty-tool omission unchanged", () => {
    expect(transform("gemini-2.5-pro", { contents: [{ role: "user", parts: [{ text: "hi" }] }], extra: "retained" }).extra).toBe("retained");
    const request = transform("claude-sonnet-4-6", { contents: [{ role: "user", parts: [{ text: "hi" }] }], toolConfig: { functionCallingConfig: { mode: "ANY" } } });
    expect(request).not.toHaveProperty("toolConfig");
  });
});
