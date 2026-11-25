import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ admit: vi.fn(), handleChat: vi.fn() }));
vi.mock("@/sse/services/admission.js", () => ({ admit: mocks.admit }));
vi.mock("@/sse/handlers/chat.js", () => ({ handleChat: mocks.handleChat }));
const { POST } = await import("../../src/app/api/v1beta/models/[...path]/route.js");
const { parseGeminiModelPath, estimateGeminiCountTokens } = await import("../../src/app/api/v1beta/models/[...path]/geminiRouteHelpers.js");

describe("OmniRoute a50e5b7904b9d686fd278b4fc6facb6f4da64d3b Gemini route", () => {
  it("keeps slash and colon model names and rejects missing models", () => {
    expect(parseGeminiModelPath(["a", "b", "qwen:7b:countTokens"])).toEqual({ model: "a/b/qwen:7b", action: ":countTokens" });
    expect(parseGeminiModelPath([":generateContent"])).toBeNull();
  });
  it("counts wrapper contents, tools and media locally without dispatching chat", async () => {
    mocks.admit.mockResolvedValue({ error: null });
    const body = { generateContentRequest: { contents: [{ parts: [{ text: "abcd" }, { inlineData: {} }] }], tools: [{ functionDeclarations: [{ name: "f" }] }] } };
    const response = await POST(new Request("http://localhost/v1beta/models/a/b:countTokens", { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ path: ["a", "b:countTokens"] }) });
    expect(await response.json()).toEqual({ totalTokens: estimateGeminiCountTokens(body) });
    expect(mocks.handleChat).not.toHaveBeenCalled();
    expect(estimateGeminiCountTokens(body)).toBeGreaterThan(259);
  });
  it("tolerates null tool entries", () => {
    expect(estimateGeminiCountTokens({ contents: [{ parts: [null, { text: "abcd" }] }], tools: [null] })).toBe(1);
  });
  it("enforces admission for counting", async () => {
    mocks.admit.mockResolvedValue({ error: new Response(null, { status: 401 }) });
    const response = await POST(new Request("http://localhost/v1beta/models/a:countTokens", { method: "POST", body: "{}" }), { params: Promise.resolve({ path: ["a:countTokens"] }) });
    expect(response.status).toBe(401);
  });
});
