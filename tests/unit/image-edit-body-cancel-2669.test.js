// #2669: a client cancel while the image-edit core reads the upstream body must
// end as a 499 cancel on both the error and the success path. Account health is
// cleared only after a successful body was read in full. Every upstream is a
// local stub; no provider is called.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => fetch(...args),
}));

const { handleImageEditCore } = await import("../../open-sse/handlers/imageEditCore.js");

const credentials = { apiKey: "fixture" };

/** Upstream that sends headers with `status`, then stalls until the fetch signal aborts. */
function stalledUpstream(status, chunks = []) {
  let headersSent;
  const sent = new Promise((resolve) => { headersSent = resolve; });
  vi.stubGlobal("fetch", vi.fn(async (_url, { signal }) => {
    const body = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
        signal.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")), { once: true });
      },
    });
    headersSent();
    return new Response(body, { status, headers: { "content-type": "application/json" } });
  }));
  return sent;
}

function edit(signal, onRequestSuccess = vi.fn()) {
  const formData = new FormData();
  formData.set("prompt", "make it blue");
  formData.set("image", new Blob(["img"], { type: "image/png" }), "a.png");
  const result = handleImageEditCore({ formData, modelInfo: { provider: "openai", model: "gpt-image-1" }, credentials, signal, onRequestSuccess });
  return { result, onRequestSuccess };
}

afterEach(() => vi.unstubAllGlobals());

describe("image edit core: cancel while reading the upstream body (#2669)", () => {
  it("returns 499 instead of throwing when the client cancels during a 429 body", async () => {
    const sent = stalledUpstream(429, ['{"error":{"message":"rate']);
    const controller = new AbortController();
    const { result, onRequestSuccess } = edit(controller.signal);
    await sent;
    controller.abort();
    const outcome = await result;

    expect(outcome.success).toBe(false);
    expect(outcome.status).toBe(499);
    expect(outcome.accounting).toBeUndefined();
    expect(outcome.cancelledUsage).toBeUndefined();
    expect(onRequestSuccess).not.toHaveBeenCalled();
  });

  it("does not clear account health when the client cancels during a 200 body", async () => {
    const sent = stalledUpstream(200, ['{"data":[{"b64_json":"aGk="}]']);
    const controller = new AbortController();
    const { result, onRequestSuccess } = edit(controller.signal);
    await sent;
    controller.abort();
    const outcome = await result;

    expect(outcome.status).toBe(499);
    expect(outcome.cancelledAfterHeaders).toBe(true);
    expect(outcome.accounting).toBeUndefined();
    expect(onRequestSuccess).not.toHaveBeenCalled();
  });

  it("clears account health once, after the 200 body was read", async () => {
    let bodyRead = false;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({
      async pull(controller) {
        // Defer the body so a premature onRequestSuccess sees it unread.
        await new Promise((resolve) => setTimeout(resolve, 20));
        controller.enqueue(new TextEncoder().encode('{"created":1,"data":[{"b64_json":"aGk="}]}'));
        bodyRead = true;
        controller.close();
      },
    }), { status: 200, headers: { "content-type": "application/json" } })));
    const onRequestSuccess = vi.fn(() => expect(bodyRead).toBe(true));
    const outcome = await edit(new AbortController().signal, onRequestSuccess).result;

    expect(outcome.success).toBe(true);
    expect(onRequestSuccess).toHaveBeenCalledOnce();
  });

  it("keeps the upstream status for a 429 body read failure that is not a client cancel", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({
      start(controller) { controller.error(new Error("socket reset")); },
    }), { status: 429 })));
    const { result, onRequestSuccess } = edit(new AbortController().signal);
    const outcome = await result;

    expect(outcome.status).toBe(429);
    expect(onRequestSuccess).not.toHaveBeenCalled();
  });

  it("still propagates a 200 body read failure that is not a client cancel, without clearing health", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({
      start(controller) { controller.error(new Error("socket reset")); },
    }))));
    const { result, onRequestSuccess } = edit(new AbortController().signal);
    await expect(result).rejects.toThrow("socket reset");
    expect(onRequestSuccess).not.toHaveBeenCalled();
  });
});
