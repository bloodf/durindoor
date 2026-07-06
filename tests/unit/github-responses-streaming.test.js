import { describe, expect, it, vi } from "vitest";

const { proxyAwareFetchMock } = vi.hoisted(() => ({
  proxyAwareFetchMock: vi.fn(),
}));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: proxyAwareFetchMock,
}));

const { GithubExecutor } = await import("../../open-sse/executors/github.js");

describe("GithubExecutor /responses escalation streaming", () => {
  it("keeps upstream Responses requests streaming for non-streaming Chat clients", async () => {
    proxyAwareFetchMock.mockResolvedValueOnce(new Response("bad", { status: 400 }));

    const exec = new GithubExecutor();
    const result = await exec.executeWithResponsesEndpoint({
      model: "gpt-5.5-codex",
      body: {
        messages: [{ role: "user", content: "hello" }],
        stream: false,
      },
      stream: false,
      credentials: { copilotToken: "ghu_test" },
      log: { debug: vi.fn() },
    });

    expect(result.transformedBody.stream).toBe(true);
    expect(result.headers.Accept).toBe("text/event-stream");

    const [, init] = proxyAwareFetchMock.mock.calls[0];
    expect(JSON.parse(init.body).stream).toBe(true);
  });
});
