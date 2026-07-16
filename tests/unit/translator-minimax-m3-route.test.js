import { describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";

const mocks = vi.hoisted(() => ({
  buildUrl: vi.fn(() => "https://api.minimax.io/v1/text/chatcompletion_v2"),
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

describe("translator console MiniMax-M3 transport selection (#2533)", () => {
  it("step 3 attaches the OpenAI runtime transport so the executor selects the M3 endpoint", async () => {
    const response = await POST({
      json: async () => ({
        step: 3,
        body: {
          provider: "minimax",
          model: "MiniMax-M3",
          body: {
            model: "MiniMax-M3",
            messages: [{ role: "user", content: "hello" }],
            stream: false,
          },
        },
      }),
    });

    expect(response.status).toBe(200);
    expect(mocks.buildUrl).toHaveBeenCalledWith(
      "MiniMax-M3",
      false,
      0,
      expect.objectContaining({
        runtimeTransport: expect.objectContaining({ format: "openai" }),
      }),
    );
    expect(mocks.buildHeaders).toHaveBeenCalledWith(
      expect.objectContaining({
        runtimeTransport: expect.objectContaining({ format: "openai" }),
      }),
      false,
    );
  });
});
