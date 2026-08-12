import "../translator/registerAll.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  proxyAwareFetch: vi.fn(),
}));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: mocks.proxyAwareFetch,
}));

import { GithubExecutor } from "../../open-sse/executors/github.js";

const makeOptions = () => ({
  model: "claude-fable-5",
  body: { messages: [{ role: "user", content: "x".repeat(400_000) }] },
  stream: true,
  credentials: { copilotToken: "test-token" },
  log: { debug: vi.fn(), warn: vi.fn() },
});

describe("GitHub Claude prompt-limit preflight", () => {
  beforeEach(() => mocks.proxyAwareFetch.mockReset());

  it("rejects an over-limit prompt before dispatch", async () => {
    mocks.proxyAwareFetch.mockResolvedValueOnce(Response.json({ input_tokens: 200_001 }));

    const result = await new GithubExecutor().executeWithMessagesEndpoint(makeOptions());

    expect(mocks.proxyAwareFetch).toHaveBeenCalledOnce();
    expect(mocks.proxyAwareFetch.mock.calls[0][0]).toBe("https://api.githubcopilot.com/v1/messages/count_tokens");
    expect(result.response.status).toBe(400);
    expect(await result.response.json()).toMatchObject({
      error: {
        message: "Prompt is 200001 tokens; maximum for claude-fable-5 is 200000.",
        code: "context_length_exceeded",
      },
    });
  });

  it("dispatches an under-limit prompt", async () => {
    mocks.proxyAwareFetch
      .mockResolvedValueOnce(Response.json({ input_tokens: 199_999 }))
      .mockResolvedValueOnce(new Response("generated", { status: 200 }));

    const result = await new GithubExecutor().executeWithMessagesEndpoint(makeOptions());

    expect(mocks.proxyAwareFetch.mock.calls.map(([url]) => url)).toEqual([
      "https://api.githubcopilot.com/v1/messages/count_tokens",
      "https://api.githubcopilot.com/v1/messages",
    ]);
    expect(result.response.status).toBe(200);
  });
});
