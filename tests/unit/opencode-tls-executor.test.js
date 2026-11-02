import { afterEach, describe, expect, it, vi } from "vitest";

// Upstream ce060c79: OpenCodeExecutor sends the free tier through the wreq-js
// TLS transport when it loads, and stays on native fetch when it does not.
const { getOpencodeTlsFetch } = vi.hoisted(() => ({ getOpencodeTlsFetch: vi.fn() }));
vi.mock("../../open-sse/services/opencodeTlsClient.js", () => ({ getOpencodeTlsFetch }));

import { OpenCodeExecutor } from "../../open-sse/executors/opencode.js";
import { BaseExecutor } from "../../open-sse/executors/base.js";

afterEach(() => {
  vi.restoreAllMocks();
  getOpencodeTlsFetch.mockReset();
});

async function baseArgsFor(tlsFetch) {
  getOpencodeTlsFetch.mockResolvedValue(tlsFetch);
  const baseExecute = vi.spyOn(BaseExecutor.prototype, "execute").mockResolvedValue({ ok: true });
  await new OpenCodeExecutor().execute({ model: "big-pickle", body: {}, stream: true, credentials: {} });
  return baseExecute.mock.calls[0][0];
}

describe("OpenCodeExecutor transport selection", () => {
  it("passes the wreq-js transport as directFetch when it loads", async () => {
    const tlsFetch = vi.fn();
    expect((await baseArgsFor(tlsFetch)).directFetch).toBe(tlsFetch);
  });

  it("keeps native fetch when wreq-js is unavailable", async () => {
    expect(await baseArgsFor(null)).not.toHaveProperty("directFetch");
  });

  it("dispatches the upstream request through the transport via BaseExecutor", async () => {
    const tlsFetch = vi.fn(async () => new Response("data: [DONE]\n\n", {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }));
    getOpencodeTlsFetch.mockResolvedValue(tlsFetch);
    const nativeFetch = vi.fn(async () => new Response("native"));
    const savedFetch = globalThis.fetch;
    globalThis.fetch = nativeFetch;
    try {
      await new OpenCodeExecutor().execute({
        model: "big-pickle",
        body: { messages: [{ role: "user", content: "hi" }] },
        stream: true,
        credentials: { id: "noauth", connectionId: "noauth" },
        proxyOptions: { disableEnvProxy: true },
      });
      expect(nativeFetch).not.toHaveBeenCalled();
      expect(tlsFetch).toHaveBeenCalledOnce();
      expect(tlsFetch.mock.calls[0][0]).toBe("https://opencode.ai/inference/v1/chat/completions");
      expect(tlsFetch.mock.calls[0][1].method).toBe("POST");
    } finally {
      globalThis.fetch = savedFetch;
    }
  });
});
