import { afterEach, describe, expect, it, vi } from "vitest";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";
import { handleChatCore } from "../../open-sse/handlers/chatCore.js";

const mockLog = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("upstream PR #4667: native Antigravity structured output schema validation", () => {
  it("resolves local $ref pointers in native generationConfig.responseSchema", () => {
    const executor = new AntigravityExecutor();
    const transformed = executor.transformRequest(
      "gemini-3-flash",
      {
        request: {
          contents: [{ role: "user", parts: [{ text: "hi" }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
              type: "object",
              $defs: { score: { type: "integer" } },
              properties: { rating: { $ref: "#/$defs/score", description: "Score" } },
            },
          },
        },
      },
      false,
      { projectId: "proj-1" }
    );

    expect(transformed.request.generationConfig.responseSchema.properties.rating).toEqual({
      type: "integer",
      description: "Score",
    });
  });

  it.each([
    ["unresolved $ref", { $ref: "#/$defs/missing" }],
    ["cyclic $ref", { $defs: { loop: { $ref: "#/$defs/loop" } }, $ref: "#/$defs/loop" }],
    ["external $ref", { $ref: "https://example.com/schema.json" }],
    ["null schema", null],
    ["array schema", []],
  ])("rejects invalid native responseSchema (%s) as a local 400 schema error", (_label, responseSchema) => {
    const executor = new AntigravityExecutor();
    expect(() => executor.transformRequest(
      "gemini-3-flash",
      {
        request: {
          contents: [{ role: "user", parts: [{ text: "hi" }] }],
          generationConfig: { responseSchema },
        },
      },
      false,
      { projectId: "proj-1" }
    )).toThrowError(expect.objectContaining({ statusCode: 400, localSchemaError: true }));
  });

  it("propagates native Antigravity executor schema errors through handleChatCore as 400 localSchemaError without network calls", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const body = {
      request: {
        contents: [{ role: "user", parts: [{ text: "hi" }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: { $ref: "#/$defs/missing" },
        },
      },
    };
    const result = await handleChatCore({
      body,
      modelInfo: { provider: "antigravity", model: "gemini-3-flash" },
      credentials: { accessToken: "test-token", connectionId: "conn-1", projectId: "proj-1" },
      connectionId: "conn-1",
      sourceFormatOverride: "antigravity",
      clientRawRequest: { endpoint: "/v1beta/models/gemini-3-flash:generateContent", body, headers: {} },
      log: mockLog(),
    });

    expect(result.status).toBe(400);
    expect(result.localSchemaError).toBe(true);
    expect(result.response[Symbol.for("durindoor.localSchemaError")]).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
