import { beforeEach, describe, expect, test, vi } from "vitest";
import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { XaiExecutor } from "../../open-sse/executors/xai.js";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

describe("xAI OAuth grok-4.5 Responses transport", () => {
  const executor = new XaiExecutor();

  beforeEach(() => {
    proxyAwareFetch.mockReset();
    proxyAwareFetch.mockResolvedValue(
      new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }),
    );
  });

  test("uses Responses for the OAuth-selected grok-4.5 transport", async () => {
    await executor.execute({
      model: "grok-4.5",
      body: { model: "grok-4.5", input: [], stream: true },
      stream: true,
      credentials: {
        accessToken: "oauth-token",
        authType: "oauth",
        runtimeTransport: { format: "openai-responses-oauth", baseUrl: "https://api.x.ai/v1/responses" },
      },
    });

    const [url, init] = proxyAwareFetch.mock.calls[0];
    expect(url).toBe("https://api.x.ai/v1/responses");
    expect(JSON.parse(init.body)).toMatchObject({ model: "grok-4.5", input: [], stream: true });
    expect(init.headers.Authorization).toBe("Bearer oauth-token");
  });

  test("keeps API-key grok-4.5 on Chat Completions", async () => {
    await executor.execute({
      model: "grok-4.5",
      body: { model: "grok-4.5", messages: [{ role: "user", content: "hi" }], stream: false },
      stream: false,
      credentials: { apiKey: "api-key" },
    });

    const [url, init] = proxyAwareFetch.mock.calls[0];
    expect(url).toBe("https://api.x.ai/v1/chat/completions");
    expect(JSON.parse(init.body)).toMatchObject({ model: "grok-4.5", messages: [{ role: "user", content: "hi" }], stream: false });
    expect(init.headers.Authorization).toBe("Bearer api-key");
  });
});
