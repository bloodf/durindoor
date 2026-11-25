import { afterEach, describe, expect, it, vi } from "vitest";
import { AzureExecutor } from "../../open-sse/executors/azure.js";

describe("Azure executor deployment URL and credentials", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("encodes the deployment name in the URL path", () => {
    const executor = new AzureExecutor();

    expect(executor.buildUrl("team/model name", false, 0, {
      providerSpecificData: { azureEndpoint: "https://example.azure.com" },
    })).toBe("https://example.azure.com/openai/deployments/team%2Fmodel%20name/chat/completions?api-version=2024-10-01-preview");
  });

  it("does not fall back to the process-wide OpenAI key", () => {
    vi.stubEnv("OPENAI_API_KEY", "global-secret");
    const executor = new AzureExecutor();

    expect(executor.buildHeaders({}, false)["api-key"]).toBeUndefined();
    expect(executor.buildHeaders({ apiKey: "connection-secret" }, false)["api-key"]).toBe("connection-secret");
    expect(executor.buildHeaders({ accessToken: "connection-token" }, false)["api-key"]).toBe("connection-token");
  });
});
