import { describe, expect, it } from "vitest";

import { withEarlyStreamKeepalive } from "../../open-sse/utils/earlyStreamKeepalive.js";

const encoder = new TextEncoder();

/** A JSON body that keeps trickling until someone cancels it. */
function tricklingBody() {
  const state = { cancelled: false };
  let timer;
  state.stream = new ReadableStream({
    start(controller) {
      timer = setInterval(() => controller.enqueue(encoder.encode(" ")), 5);
    },
    cancel() {
      state.cancelled = true;
      clearInterval(timer);
    },
  });
  return state;
}

const late = (response, ms = 20) => new Promise((resolve) => setTimeout(() => resolve(response), ms));
const json = (body, status = 429) => new Response(body, { status, headers: { "Content-Type": "application/json" } });

describe("OmniRoute #19713 - a late non-SSE body behind the keepalive is bounded", () => {
  it("cancels a trickling body on deadline and sends an error frame", async () => {
    const body = tricklingBody();
    const response = await withEarlyStreamKeepalive(late(json(body.stream)), { thresholdMs: 1, bodyTimeoutMs: 60 });

    const text = await response.text();

    expect(text).toContain('data: {"error":');
    expect(text).toContain('"status_code":429');
    expect(body.cancelled).toBe(true);
  });

  it("cancels the body read when the client disconnects", async () => {
    const body = tricklingBody();
    const client = new AbortController();
    const response = await withEarlyStreamKeepalive(late(json(body.stream)), {
      thresholdMs: 1, bodyTimeoutMs: 60_000, signal: client.signal,
    });
    const drained = response.text();
    await new Promise((resolve) => setTimeout(resolve, 60));

    client.abort();

    expect(await drained).not.toContain('"error"');
    expect(body.cancelled).toBe(true);
  });

  it("releases a reply that arrives after the client left", async () => {
    const body = tricklingBody();
    const client = new AbortController();
    const response = await withEarlyStreamKeepalive(late(json(body.stream), 40), { thresholdMs: 1, signal: client.signal });

    client.abort();
    await response.text();
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(body.cancelled).toBe(true);
  });

  it("still frames a body that finishes in time", async () => {
    const response = await withEarlyStreamKeepalive(
      late(json(JSON.stringify({ error: { message: "upstream_busy", type: "rate_limit_error" } }))),
      { thresholdMs: 1, bodyTimeoutMs: 5_000 },
    );

    expect(await response.text()).toContain('"message":"upstream_busy"');
  });
});
