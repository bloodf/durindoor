import { describe, expect, it } from "vitest";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { resolveRequestTransport } from "../../open-sse/handlers/chatCore.js";

describe("9router #5844 (3ee27755532fbc897db9aeb57d8e3f8ccb1798aa) Kimi platform Responses", () => {
  it("routes Responses requests to Moonshot with bearer authentication", () => {
    const { runtimeTransport, targetFormat } = resolveRequestTransport({
      provider: "kimi", alias: "kimi", model: "kimi-k3", sourceFormat: "openai-responses", credentials: { apiKey: "test-key" },
    });
    const credentials = { apiKey: "test-key", runtimeTransport };
    const executor = new DefaultExecutor("kimi");
    expect(targetFormat).toBe("openai-responses");
    expect(executor.buildUrl("kimi-k3", true, 0, credentials)).toBe("https://api.moonshot.ai/v1/responses");
    expect(executor.buildHeaders(credentials, true).Authorization).toBe("Bearer test-key");
  });

  it("routes dynamically synced model IDs and keeps the default without credentials", () => {
    const request = { provider: "kimi", alias: "kimi", model: "synced-model", sourceFormat: "openai-responses" };
    expect(resolveRequestTransport({ ...request, credentials: { apiKey: "test-key" } }).targetFormat).toBe("openai-responses");
    expect(resolveRequestTransport({ ...request, credentials: null }).targetFormat).toBe("claude");
  });
});
