import { describe, expect, it, vi } from "vitest";

const { proxyAwareFetchMock } = vi.hoisted(() => ({
  proxyAwareFetchMock: vi.fn(),
}));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: proxyAwareFetchMock,
}));

const { GithubExecutor } = await import("../../open-sse/executors/github.js");

// GitHub Copilot rejects `temperature` on GPT-5.4+ (within 5.x) and GPT-6.x.
// The /responses route bypasses transformRequest(), so the unsupported-parameter
// filter has to run on the translated Responses body too.
describe("GithubExecutor unsupported temperature", () => {
  it.each([
    ["gpt-5.4", true],
    ["gpt-5.4-mini", true],
    ["gpt-6-luna", true],
    ["gpt-6.1-sol", true],
    ["gpt-5.3-codex", false],
  ])("filters the Responses request for %s (stripped: %s)", async (model, stripped) => {
    proxyAwareFetchMock.mockReset();
    proxyAwareFetchMock.mockResolvedValueOnce(new Response("data: [DONE]\n\n", {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }));
    const body = { messages: [{ role: "user", content: "hello" }], temperature: 0.7 };

    await new GithubExecutor().executeWithResponsesEndpoint({
      model,
      body,
      stream: true,
      credentials: { copilotToken: "ghu_test" },
      log: { debug: vi.fn() },
    });

    const sent = JSON.parse(proxyAwareFetchMock.mock.calls.at(-1)[1].body);
    if (stripped) expect(sent).not.toHaveProperty("temperature");
    else expect(sent.temperature).toBe(0.7);
    // The caller's body is never mutated.
    expect(body.temperature).toBe(0.7);
  });

  it.each([
    ["gpt-5.4", true],
    ["gpt-6.1-sol", true],
    ["gpt-5.3-codex", false],
  ])("filters the chat request for %s (stripped: %s)", (model, stripped) => {
    const body = { messages: [{ role: "user", content: "hello" }], temperature: 0.7 };

    const transformed = new GithubExecutor().transformRequest(model, body, true, { copilotToken: "ghu_test" });

    if (stripped) expect(transformed).not.toHaveProperty("temperature");
    else expect(transformed.temperature).toBe(0.7);
    expect(body.temperature).toBe(0.7);
  });
});
