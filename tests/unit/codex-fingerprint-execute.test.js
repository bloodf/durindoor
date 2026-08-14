import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CodexExecutor } from "../../open-sse/executors/codex.js";
import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

const encoder = new TextEncoder();

function outputResponse(text = "hi") {
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode("event: response.output_text.delta\n"));
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "response.output_text.delta", delta: text })}\n\n`),
        );
        controller.close();
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
}

function makeExecutor() {
  const executor = new CodexExecutor();
  executor.config = {
    ...executor.config,
    baseUrl: "https://api.openai.test/v1/responses",
    baseUrls: undefined,
  };
  return executor;
}

function oauthCredentials(mode) {
  return {
    apiKey: undefined,
    accessToken: "oauth-access",
    connectionId: "connection-a",
    providerSpecificData: { workspaceId: "workspace-a", codexFingerprintMode: mode },
  };
}

async function run(executor, credentials, clientHeaders = {}) {
  const result = await executor.execute({
    model: "gpt-5.3-codex",
    body: { model: "gpt-5.3-codex", input: [{ role: "user", content: "hi" }] },
    stream: true,
    credentials,
    requestContext: { compact: false, clientHeaders },
  });
  await result.response.text();
  const [, init] = fetchMock.mock.calls.at(-1);
  return { headers: init.headers, body: JSON.parse(init.body) };
}

let fetchMock;

describe("Codex executor fingerprint convergence end-to-end", () => {
  beforeEach(() => {
    fetchMock = vi.mocked(proxyAwareFetch);
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => outputResponse());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("preserves caller-provided identity when mode is off", async () => {
    const executor = makeExecutor();
    const clientHeaders = {
      "session-id": "caller-session",
      session_id: "caller-session",
      "thread-id": "caller-thread",
      thread_id: "caller-thread",
      "x-client-request-id": "caller-req",
      "x-codex-installation-id": "caller-installation",
      "x-codex-window-id": "caller-window",
      "x-codex-turn-metadata": '{"caller":true}',
    };
    const { headers, body } = await run(executor, oauthCredentials("off"), clientHeaders);

    expect(headers["x-codex-installation-id"]).toBe("caller-installation");
    expect(headers["session-id"]).toBe("caller-session");
    expect(headers["thread-id"]).toBe("caller-thread");
    expect(headers["x-client-request-id"]).toBe("caller-req");
    expect(headers["x-codex-window-id"]).toBe("caller-window");
    expect(headers["x-codex-turn-metadata"]).toBe('{"caller":true}');
    expect(body.client_metadata).toBeUndefined();
  });

  it("emits only the installation id for device mode, in headers and body", async () => {
    const executor = makeExecutor();
    const { headers, body } = await run(executor, oauthCredentials("device"));

    expect(headers["x-codex-installation-id"]).toEqual(expect.any(String));
    expect(headers["session-id"]).toBeUndefined();
    expect(headers["session_id"]).toBeUndefined();
    expect(headers["thread-id"]).toBeUndefined();
    expect(headers["x-client-request-id"]).toBeUndefined();
    expect(headers["x-codex-window-id"]).toBeUndefined();
    expect(body.client_metadata).toMatchObject({
      "x-codex-installation-id": headers["x-codex-installation-id"],
    });
    expect(body.client_metadata.session_id).toBeUndefined();
    expect(body.client_metadata.thread_id).toBeUndefined();
  });

  it("converges session mode onto a stable session and thread id per account", async () => {
    const executor = makeExecutor();
    const credentials = oauthCredentials("session");
    const clientHeaders = { "session-id": "client-session" };
    const first = await run(executor, credentials, clientHeaders);
    const second = await run(executor, credentials, clientHeaders);

    expect(first.headers["session-id"]).toEqual(expect.any(String));
    expect(first.headers["session-id"]).toBe(second.headers["session-id"]);
    expect(first.headers["thread-id"]).toBe(second.headers["thread-id"]);
    expect(first.headers["x-client-request-id"]).toBe(first.headers["thread-id"]);
    expect(first.body.client_metadata).toMatchObject({
      session_id: first.headers["session-id"],
      thread_id: first.headers["thread-id"],
    });
    expect(first.body.client_metadata.turn_id).toEqual(expect.any(String));
    expect(first.body.client_metadata.turn_id).not.toBe(second.body.client_metadata.turn_id);
  });

  it("converges full mode onto a single session/thread identity, matching upstream semantics", async () => {
    const executor = makeExecutor();
    const credentials = oauthCredentials("full");
    const { headers, body } = await run(executor, credentials);

    // Upstream (8417ace4b37): full mode sets threadId = sessionId (single converged
    // identity), unlike session mode which derives a distinct per-client thread id.
    expect(headers["thread-id"]).toBe(headers["session-id"]);
    expect(body.client_metadata.thread_id).toBe(body.client_metadata.session_id);
  });

  it("skips fingerprinting on the compact endpoint, forwarding caller identity", async () => {
    const executor = makeExecutor();
    const credentials = oauthCredentials("session");
    const clientHeaders = { "session-id": "caller-session" };
    const result = await executor.execute({
      model: "gpt-5.3-codex",
      body: { model: "gpt-5.3-codex", input: [{ role: "user", content: "hi" }], _compact: true },
      stream: true,
      credentials,
      requestContext: { compact: true, clientHeaders },
    });
    await result.response.text();
    const [url, init] = fetchMock.mock.calls.at(-1);

    expect(url).toBe("https://api.openai.test/v1/responses/compact");
    expect(init.headers["session_id"]).toBe("caller-session");
  });
});
