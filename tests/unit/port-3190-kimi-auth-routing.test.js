import { describe, expect, it } from "vitest";
import { resolveRequestTransport } from "../../open-sse/handlers/chatCore.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";

function route(provider, alias, credentials) {
  const model = provider === "kimi" ? "kimi-k3" : "kimi-for-coding";
  const { runtimeTransport } = resolveRequestTransport({ provider, alias, model, sourceFormat: "openai", credentials });
  const executor = new DefaultExecutor(provider);
  const routed = { ...credentials, runtimeTransport };
  return { url: executor.buildUrl(model, true, 0, routed), headers: executor.buildHeaders(routed, true) };
}

describe("port(upstream) #3190 - Kimi API-key and OAuth connections use separate platforms", () => {
  it("sends a platform API key to Moonshot Open Platform with Bearer auth", () => {
    const { url, headers } = route("kimi", "kimi", { authType: "apikey", apiKey: "platform-key" });

    expect(url).toBe("https://api.moonshot.ai/v1/chat/completions");
    expect(headers.Authorization).toBe("Bearer platform-key");
    expect(headers["x-api-key"]).toBeUndefined();
  });

  it("keeps a Kimi Code OAuth token on the Kimi Code endpoint", () => {
    const { url, headers } = route("kimi-coding", "kmc", { authType: "oauth", accessToken: "oauth-token" });

    // Chat clients stay on this provider's default Claude transport.
    expect(new URL(url).origin + new URL(url).pathname).toBe("https://api.kimi.com/coding/v1/messages");
    expect(headers["x-api-key"]).toBe("oauth-token");
  });
});
