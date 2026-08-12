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

  it("dispatches when token counting returns a server error", async () => {
    mocks.proxyAwareFetch
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(new Response("generated", { status: 200 }));
    const options = makeOptions();

    const result = await new GithubExecutor().executeWithMessagesEndpoint(options);

    expect(mocks.proxyAwareFetch.mock.calls.map(([url]) => url)).toEqual([
      "https://api.githubcopilot.com/v1/messages/count_tokens",
      "https://api.githubcopilot.com/v1/messages",
    ]);
    expect(result.response.status).toBe(200);
    expect(options.log.warn).toHaveBeenCalledWith("GITHUB", "Prompt token preflight returned 503; continuing");
  });

  it("dispatches when token counting returns an unparseable body", async () => {
    mocks.proxyAwareFetch
      .mockResolvedValueOnce(new Response("not-json", { status: 200 }))
      .mockResolvedValueOnce(new Response("generated", { status: 200 }));
    const options = makeOptions();

    const result = await new GithubExecutor().executeWithMessagesEndpoint(options);

    expect(mocks.proxyAwareFetch.mock.calls.map(([url]) => url)).toEqual([
      "https://api.githubcopilot.com/v1/messages/count_tokens",
      "https://api.githubcopilot.com/v1/messages",
    ]);
    expect(result.response.status).toBe(200);
    expect(options.log.warn).toHaveBeenCalledWith(
      "GITHUB",
      expect.stringMatching(/^Prompt token preflight failed: .*JSON.*; continuing$/),
    );
  });

  it("dispatches when token counting rejects at the network layer", async () => {
    mocks.proxyAwareFetch
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(new Response("generated", { status: 200 }));
    const options = makeOptions();

    const result = await new GithubExecutor().executeWithMessagesEndpoint(options);

    expect(mocks.proxyAwareFetch.mock.calls.map(([url]) => url)).toEqual([
      "https://api.githubcopilot.com/v1/messages/count_tokens",
      "https://api.githubcopilot.com/v1/messages",
    ]);
    expect(result.response.status).toBe(200);
    expect(options.log.warn).toHaveBeenCalledWith(
      "GITHUB",
      "Prompt token preflight failed: fetch failed; continuing",
    );
  });
});
