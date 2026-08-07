import { describe, expect, it, vi, beforeEach } from "vitest";
import "../translator/registerAll.js";

const mocks = vi.hoisted(() => ({
  buildUrl: vi.fn(() => "https://blackbox.test/v1/chat/completions"),
  buildHeaders: vi.fn(() => ({ Authorization: "Bearer test" })),
  transformRequest: vi.fn((_model, body) => body),
  connection: { apiKey: "test-key" },
}));

vi.mock("@/lib/localDb.js", () => ({
  getProviderConnections: vi.fn(async () => [{
    isActive: true,
    apiKey: mocks.connection.apiKey,
    providerSpecificData: {},
  }]),
}));

vi.mock("@/sse/services/model.js", () => ({
  getModelInfo: vi.fn(),
}));

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({
    buildUrl: mocks.buildUrl,
    buildHeaders: mocks.buildHeaders,
    transformRequest: mocks.transformRequest,
  }),
}));

const { POST } = await import("../../src/app/api/translator/translate/route.js");

describe("translator console model suffix boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.connection.apiKey = "test-key";
    mocks.buildUrl.mockImplementation(() => "https://blackbox.test/v1/chat/completions");
    mocks.buildHeaders.mockImplementation(() => ({ Authorization: "Bearer test" }));
    mocks.transformRequest.mockImplementation((_model, body) => body);
  });
  it("passes only the clean mapped model to URL and request builders", async () => {
    const response = await POST({
      json: async () => ({
        step: 3,
        body: {
          provider: "blackbox",
          model: "gpt-5.5(high)",
          body: {
            model: "gpt-5.5(high)",
            messages: [{ role: "user", content: "hello" }],
            stream: false,
          },
        },
      }),
    });

    expect(response.status).toBe(200);
    expect(mocks.buildUrl).toHaveBeenCalledWith(
      "blackboxai/openai/gpt-5.5",
      false,
      0,
      expect.any(Object),
    );
    expect(mocks.transformRequest.mock.calls[0][0]).toBe("blackboxai/openai/gpt-5.5");
    expect(mocks.transformRequest.mock.calls[0][1].model).toBe(
      "blackboxai/openai/gpt-5.5",
    );
    expect(JSON.stringify(mocks.transformRequest.mock.calls[0][1])).not.toContain("(high)");
  });

  it("passes Antigravity tier intent separately from the clean wire model", async () => {
    const response = await POST({
      json: async () => ({
        step: 3,
        body: {
          provider: "antigravity",
          model: "gemini-3.6-flash-high",
          body: {
            model: "gemini-3.6-flash-high",
            messages: [{ role: "user", content: "hello" }],
            stream: false,
          },
        },
      }),
    });

    expect(response.status).toBe(200);
    expect(mocks.buildUrl).toHaveBeenCalledWith(
      "gemini-3.6-flash-tiered",
      false,
      0,
      expect.any(Object),
    );
    expect(mocks.transformRequest.mock.calls[0][0]).toBe("gemini-3.6-flash-tiered");
    expect(mocks.transformRequest.mock.calls[0][1]).toMatchObject({
      model: "gemini-3.6-flash-tiered",
      request: {
        generationConfig: {
          thinkingConfig: { thinkingLevel: "high", includeThoughts: true },
        },
      },
    });
  });

  it("fails non-2xx and never leaks a credential when the provider's executor is fail-closed", async () => {
    // Regression: a blocked provider (e.g. devin cloud-agent, kind agent, no chat
    // transport) throws from buildUrl/buildHeaders. The route must map that to a
    // non-2xx { success: false } with NO credential material and no upstream URL
    // in the serialized response, and must NOT proceed to buildHeaders /
    // transformRequest after the throw.
    const SECRET = "cog_token_secret_route_level";
    mocks.connection.apiKey = SECRET;
    mocks.buildUrl.mockImplementationOnce(() => {
      throw new Error(
        "devin runtime execution is not available: cloud-agent provider (kind: agent) with no chat transport — credential/catalog only.",
      );
    });

    const response = await POST({
      json: async () => ({
        step: 3,
        body: {
          provider: "devin",
          model: "devin/devin",
          body: {
            model: "devin/devin",
            messages: [{ role: "user", content: "hello" }],
            stream: false,
          },
        },
      }),
    });

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.success).toBe(false);

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(SECRET);
    expect(serialized).not.toContain("Authorization");
    expect(serialized).not.toContain("api.openai.com");
    // The route threw before reaching the credential-bearing builders.
    expect(mocks.buildHeaders).not.toHaveBeenCalled();
    expect(mocks.transformRequest).not.toHaveBeenCalled();
  });
});
