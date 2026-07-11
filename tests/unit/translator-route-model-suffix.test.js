import { describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";

const mocks = vi.hoisted(() => ({
  buildUrl: vi.fn(() => "https://blackbox.test/v1/chat/completions"),
  buildHeaders: vi.fn(() => ({ Authorization: "Bearer test" })),
  transformRequest: vi.fn((_model, body) => body),
}));

vi.mock("@/lib/localDb.js", () => ({
  getProviderConnections: vi.fn(async () => [{
    isActive: true,
    apiKey: "test-key",
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
});
