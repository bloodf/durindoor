import { beforeEach, describe, expect, test, vi } from "vitest";
import { XaiExecutor } from "../../open-sse/executors/xai.js";
import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: vi.fn() }));

describe("xAI Responses request compatibility", () => {
  beforeEach(() => {
    proxyAwareFetch.mockReset();
    proxyAwareFetch.mockResolvedValue(new Response("{}", { status: 200 }));
  });

  for (const stream of [false, true]) {
    test(`omits unsupported stop on OAuth Responses (stream=${stream})`, async () => {
      await new XaiExecutor().execute({
        model: "grok-4.5", stream,
        body: { model: "grok-4.5", input: "hello", stream, stop: ["end"] },
        credentials: { accessToken: "fake-oauth", authType: "oauth", runtimeTransport: { format: "openai-responses-oauth", baseUrl: "https://api.x.ai/v1/responses" } },
      });
      const [url, init] = proxyAwareFetch.mock.calls[0];
      expect(url).toBe("https://api.x.ai/v1/responses");
      expect(JSON.parse(init.body)).not.toHaveProperty("stop");
    });
  }

  test("retains stop for API-key chat completions", async () => {
    await new XaiExecutor().execute({ model: "grok-4", stream: false,
      body: { model: "grok-4", messages: [], stop: ["end"] }, credentials: { apiKey: "fake-key" } });
    expect(JSON.parse(proxyAwareFetch.mock.calls[0][1].body).stop).toEqual(["end"]);
  });
});
