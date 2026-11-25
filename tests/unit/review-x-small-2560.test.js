import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ handleChat: vi.fn(), transform: vi.fn() }));
vi.mock("@/sse/handlers/chat.js", () => ({ handleChat: mocks.handleChat }));
vi.mock("@/sse/utils/requestCorrelation.js", () => ({
  withRequestCorrelation: (handler) => handler,
  withHttpRequestCorrelation: (handler) => handler,
  getRequestId: () => "test",
}));
vi.mock("@/sse/services/admission.js", () => ({ admit: async () => ({ auth: { stored: true } }) }));
vi.mock("open-sse/utils/ollamaTransform.js", () => ({ transformToOllama: mocks.transform }));

import { POST } from "../../src/app/api/v1/api/chat/route.js";
import { withCatalogDeadline } from "../../src/shared/models/catalogDeadline.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

afterEach(() => vi.useRealTimers());

describe("compressed Ollama requests", () => {
  it("uses the decoded requested model in the response", async () => {
    mocks.handleChat.mockResolvedValue(new Response("ok"));
    mocks.transform.mockImplementation((response) => response);
    const request = new Request("http://localhost/v1/api/chat", {
      method: "POST", headers: { "content-encoding": "gzip" },
      body: gzipSync(JSON.stringify({ model: "requested-model", messages: [] })),
    });
    await POST(request);
    expect(mocks.transform).toHaveBeenCalledWith(expect.any(Response), "requested-model");
    expect(await mocks.handleChat.mock.calls.at(-1)[0].json()).toMatchObject({ model: "requested-model" });
  });
});

describe("superseded catalog flights", () => {
  it.each(["resolve", "reject"])("ignores a late %s after a newer flight finishes", async (settle) => {
    vi.useFakeTimers();
    const identity = ["issue-2566", settle];
    const old = deferred();
    const first = withCatalogDeadline(identity, () => old.promise, 10);
    await vi.advanceTimersByTimeAsync(10);
    expect(await first).toBeNull();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await withCatalogDeadline(identity, async () => "new", 10)).toBe("new");
    if (settle === "resolve") old.resolve("old");
    else old.reject(new Error("stale failure"));
    await vi.advanceTimersByTimeAsync(0);
    const next = withCatalogDeadline(identity, () => new Promise(() => {}), 10);
    await vi.advanceTimersByTimeAsync(10);
    expect(await next).toBe("new");
  });
});
