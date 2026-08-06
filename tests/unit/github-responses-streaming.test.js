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

  it("marks a raw Responses completion as validated", async () => {
    const raw = [
      `event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response: { status: "completed" } })}`,
      "data: [DONE]",
      "",
    ].join("\n\n");
    proxyAwareFetchMock.mockResolvedValueOnce(new Response(raw, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }));
    const result = await new GithubExecutor().executeWithResponsesEndpoint({
      model: "gpt-5.5-codex",
      body: { messages: [{ role: "user", content: "hello" }] },
      stream: true,
      credentials: { copilotToken: "ghu_test" },
      log: { debug: vi.fn() },
    });
    expect(result.terminalProvenance).toBe("validated");
    expect(await result.response.text()).toContain("data: [DONE]");
  });

  it("rejects contradictory Responses terminal framing without DONE", async () => {
    const raw = [
      `event: response.completed\ndata: ${JSON.stringify({ type: "response.failed", response: { status: "failed" } })}`,
      "data: [DONE]",
      "",
    ].join("\n\n");
    proxyAwareFetchMock.mockResolvedValueOnce(new Response(raw, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }));
    const result = await new GithubExecutor().executeWithResponsesEndpoint({
      model: "gpt-5.5-codex",
      body: { messages: [] },
      stream: true,
      credentials: { copilotToken: "ghu_test" },
      log: { debug: vi.fn() },
    });
    const text = await result.response.text();
    expect(text).toContain("GitHub Responses stream failed");
    expect(text).not.toContain("data: [DONE]");
  });

  it("converts response.incomplete into a coherent length terminal", async () => {
    const raw = [
      `event: response.created\ndata: ${JSON.stringify({ type: "response.created", response: { id: "resp-incomplete" } })}`,
      `event: response.incomplete\ndata: ${JSON.stringify({ type: "response.incomplete", response: { status: "incomplete" } })}`,
      "data: [DONE]",
      "",
    ].join("\n\n");
    proxyAwareFetchMock.mockResolvedValueOnce(new Response(raw, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }));
    const result = await new GithubExecutor().executeWithResponsesEndpoint({
      model: "gpt-5.5-codex",
      body: { messages: [] },
      stream: true,
      credentials: { copilotToken: "ghu_test" },
      log: { debug: vi.fn() },
    });
    const text = await result.response.text();
    expect(text).toContain('"finish_reason":"length"');
    expect(text).toContain("data: [DONE]");
  });

  it.each([
    ["completed then failed", [
      `event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response: { status: "completed" } })}`,
      `event: response.failed\ndata: ${JSON.stringify({ type: "response.failed", response: { status: "failed" } })}`,
    ]],
    ["DONE then data", [
      `event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response: { status: "completed" } })}`,
      "data: [DONE]",
      `event: response.output_text.delta\ndata: ${JSON.stringify({ type: "response.output_text.delta", delta: "late" })}`,
    ]],
  ])("rejects post-terminal frames: %s", async (_label, frames) => {
    proxyAwareFetchMock.mockResolvedValueOnce(new Response(`${frames.join("\n\n")}\n\n`, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }));
    const result = await new GithubExecutor().executeWithResponsesEndpoint({
      model: "gpt-5.5-codex",
      body: { messages: [] },
      stream: true,
      credentials: { copilotToken: "ghu_test" },
      log: { debug: vi.fn() },
    });
    const text = await result.response.text();
    expect(text).toContain("GitHub Responses stream failed");
    expect(text).not.toContain("data: [DONE]");
  });

  it.each([
    ["Messages", "executeWithMessagesEndpoint", [
      `event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { id: "msg_1", usage: { input_tokens: 1, output_tokens: 0 } } })}`,
      `event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } })}`,
      `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}`,
    ].join("\n\n")],
    ["Responses", "executeWithResponsesEndpoint", [
      `event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response: { status: "completed" } })}`,
    ].join("\n\n")],
  ])("synthesizes DONE for %s only when request body stream is true", async (_route, method, raw) => {
    for (const stream of [false, undefined, true]) {
      proxyAwareFetchMock.mockResolvedValueOnce(new Response(`${raw}\n\n`, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }));
      const body = stream === undefined
        ? { messages: [{ role: "user", content: "hello" }] }
        : { messages: [{ role: "user", content: "hello" }], stream };
      const result = await new GithubExecutor()[method]({
        model: method === "executeWithMessagesEndpoint" ? "claude-sonnet-4.6" : "gpt-5.5-codex",
        body,
        stream: true,
        credentials: { copilotToken: "ghu_test" },
        log: { debug: vi.fn() },
      });

      const text = await result.response.text();
      expect(text.includes("data: [DONE]"), `body.stream=${stream}`).toBe(stream === true);
    }
  });

  it.each([
    ["Messages", "executeWithMessagesEndpoint", [
      `event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { id: "msg_1", usage: { input_tokens: 1, output_tokens: 0 } } })}`,
      `event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } })}`,
      `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}`,
      "data: [DONE]",
    ].join("\n\n")],
    ["Responses", "executeWithResponsesEndpoint", [
      `event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response: { status: "completed" } })}`,
      "data: [DONE]",
    ].join("\n\n")],
  ])("preserves genuine upstream DONE for non-streaming %s requests", async (_route, method, raw) => {
    for (const stream of [false, undefined]) {
      proxyAwareFetchMock.mockResolvedValueOnce(new Response(`${raw}\n\n`, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }));
      const body = stream === undefined
        ? { messages: [{ role: "user", content: "hello" }] }
        : { messages: [{ role: "user", content: "hello" }], stream };
      const result = await new GithubExecutor()[method]({
        model: method === "executeWithMessagesEndpoint" ? "claude-sonnet-4.6" : "gpt-5.5-codex",
        body,
        stream: false,
        credentials: { copilotToken: "ghu_test" },
        log: { debug: vi.fn() },
      });

      expect(await result.response.text()).toContain("data: [DONE]");
    }
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
