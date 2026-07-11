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

  it("never logs an arbitrary Copilot token error body", async () => {
    const canary = "opaque-copilot-error-body-987654321";
    const response = new Response(canary, { status: 401 });
    const cancel = vi.spyOn(response.body, "cancel");
    proxyAwareFetchMock.mockResolvedValueOnce(response);
    const log = { info: vi.fn(), error: vi.fn() };

    await expect(new GithubExecutor().refreshCopilotToken("github-access", log)).resolves.toBeNull();

    expect(log.error).toHaveBeenCalledWith("TOKEN", "Copilot token refresh failed with HTTP 401");
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.error.mock.calls)).not.toContain(canary);
  });
});
