// Antigravity's in-stream empty retry is DurinDoor's recovery stream. Every
// upstream here is a local ReadableStream; nothing reaches a provider.
import { describe, expect, it, vi } from "vitest";
import { createEmptyRetryStream } from "../../open-sse/handlers/chatCore/emptyStreamGuard.js";

const encoder = new TextEncoder();
const flush = () => new Promise((resolve) => setTimeout(resolve, 20));

const emptyBody = () => new ReadableStream({
  start(controller) {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ response: { candidates: [{ finishReason: "STOP" }] } })}\n\n`));
    controller.close();
  },
});

/** An upstream that never answers; records cancellation and reads. */
function hangingBody({ acknowledge } = {}) {
  const seen = { pulls: 0, cancellations: [] };
  const pulled = Promise.withResolvers();
  const body = new ReadableStream({
    pull() { seen.pulls++; pulled.resolve(); return new Promise(() => {}); },
    cancel(reason) { seen.cancellations.push(reason); return acknowledge; },
  }, { highWaterMark: 0 });
  return { body, seen, pulled: pulled.promise };
}

function wrap(options) {
  const hooks = { onExhausted: vi.fn(), onAttemptDiscarded: vi.fn() };
  const reader = createEmptyRetryStream({ log: null, baseDelayMs: 1, ...hooks, ...options }).getReader();
  return { reader, hooks, pending: reader.read() };
}

describe("OmniRoute #21140 - abandoned recovery streams are cancelled", () => {
  it("does not retry or bench the account after the client cancels a pending attempt", async () => {
    const upstream = hangingBody();
    const reexecute = vi.fn(async () => emptyBody());
    const { reader, hooks, pending } = wrap({ body: upstream.body, reexecute });
    await upstream.pulled;
    const reason = new Error("client disconnected");
    await reader.cancel(reason);
    await pending;
    await flush();

    expect(upstream.seen.cancellations).toEqual([reason]);
    expect(reexecute).not.toHaveBeenCalled();
    expect(hooks.onExhausted).not.toHaveBeenCalled();
    // The abandoned attempt's dispatch ticket is still settled, as a client abort.
    expect(hooks.onAttemptDiscarded).toHaveBeenCalledTimes(1);
    expect(hooks.onAttemptDiscarded.mock.calls[0].slice(1)).toEqual(["cancelled", { final: true, aborted: true }]);
  });

  it("spends no retry when the client cancels during the backoff", async () => {
    const reexecute = vi.fn(async () => emptyBody());
    const discarded = Promise.withResolvers();
    const { reader, hooks, pending } = wrap({
      body: emptyBody(), reexecute, baseDelayMs: 30,
      onAttemptDiscarded: vi.fn(() => discarded.resolve()),
    });
    await discarded.promise;
    await reader.cancel(new Error("client disconnected"));
    await pending;
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(reexecute).not.toHaveBeenCalled();
    expect(hooks.onExhausted).not.toHaveBeenCalled();
  });

  it.each(["cancel", "abort signal"])("cancels a replacement body that arrives after a client %s", async (how) => {
    const opening = Promise.withResolvers();
    const opened = Promise.withResolvers();
    const late = hangingBody();
    const abort = new AbortController();
    const { reader, hooks, pending } = wrap({
      body: emptyBody(), signal: abort.signal,
      reexecute: () => { opening.resolve(); return opened.promise; },
    });
    const outcome = pending.then(() => null, (error) => error);
    await opening.promise;
    if (how === "cancel") await reader.cancel(new Error("client disconnected"));
    else abort.abort();
    opened.resolve(late.body);
    await flush();
    await outcome;

    expect(late.seen.cancellations).toHaveLength(1);
    expect(late.seen.pulls).toBe(0);
    expect(late.body.locked).toBe(false);
    expect(hooks.onAttemptDiscarded).toHaveBeenLastCalledWith(late.body, "cancelled", { final: true, aborted: true });
    expect(hooks.onExhausted).not.toHaveBeenCalled();
  });

  it("does not bench the account when the retry fails after the client cancelled", async () => {
    const opening = Promise.withResolvers();
    const opened = Promise.withResolvers();
    const { reader, hooks, pending } = wrap({
      body: emptyBody(),
      reexecute: () => { opening.resolve(); return opened.promise; },
    });
    await opening.promise;
    await reader.cancel(new Error("client disconnected"));
    opened.reject(new Error("[502] upstream closed"));
    await pending;
    await flush();

    expect(hooks.onExhausted).not.toHaveBeenCalled();
  });

  it("finishes the downstream cancel without waiting for the upstream to acknowledge", async () => {
    const upstream = hangingBody({ acknowledge: new Promise(() => {}) });
    const { reader, pending } = wrap({ body: upstream.body, reexecute: vi.fn() });
    await upstream.pulled;
    const finished = await Promise.race([reader.cancel(new Error("gone")).then(() => true), flush().then(() => false)]);
    await pending;

    expect(finished).toBe(true);
    expect(upstream.seen.cancellations).toHaveLength(1);
  });
});
