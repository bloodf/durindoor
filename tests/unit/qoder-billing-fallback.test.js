import { describe, expect, it } from "vitest";

import { __test__ as qoderExecutorInternals } from "../../open-sse/executors/qoder.js";

function responseFromChunks(chunks) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  }));
}

function envelope(statusCodeValue, body) {
  return `data: ${JSON.stringify({ statusCodeValue, body })}\n\n`;
}

function responseWithReader(chunks, { stall = false } = {}) {
  const encoder = new TextEncoder();
  const response = new Response(new ReadableStream({
    start(controller) {
      if (!stall) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      }
    },
  }));
  return response;
}

function delayedResponse(chunks, delayMs) {
  const encoder = new TextEncoder();
  let index = 0;
  return new Response(new ReadableStream({
    async pull(controller) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      if (index < chunks.length) controller.enqueue(encoder.encode(chunks[index++]));
      else controller.close();
    },
  }));
}

describe("Qoder stream-start billing fallback", () => {
  const { wrapQoderSSE } = qoderExecutorInternals;

  it.each([
    JSON.stringify({ code: "112", message: "quota exhausted" }),
    JSON.stringify({ code: "10605", message: "queue throttled" }),
    JSON.stringify({ pricingUrl: "https://qoder.sh/pricing" }),
  ])("returns 403 before committing a billing-blocked stream: %s", async (body) => {
    const wrapped = await wrapQoderSSE(responseFromChunks([envelope(403, body)]), "qoder/auto");

    expect(wrapped.status).toBe(403);
    expect(wrapped.headers.get("content-type")).toContain("application/json");
    await expect(wrapped.json()).resolves.toEqual({ error: { message: body, code: 403 } });
  });

  it("detects billing frame after same-chunk SSE preamble", async () => {
    const body = JSON.stringify({ code: "112", message: "quota exhausted" });
    const wrapped = await wrapQoderSSE(responseFromChunks([
      `: keepalive\n\n${envelope(403, body)}`,
    ]), "qoder/auto");

    expect(wrapped.status).toBe(403);
    await expect(wrapped.json()).resolves.toEqual({ error: { message: body, code: 403 } });
  });

  it("fails a stalled first frame instead of waiting after headers", async () => {
    const stalled = new Response(new ReadableStream({ start() {} }));

    await expect(wrapQoderSSE(stalled, "qoder/auto", { timeoutMs: 1 })).rejects.toThrow(
      "qoder stream-start timeout",
    );
  });

  it("uses one absolute deadline when bytes drip before the first frame", async () => {
    const dripped = delayedResponse(["d", "a", "t", "a", ":"], 10);

    await expect(wrapQoderSSE(dripped, "qoder/auto", { timeoutMs: 25 })).rejects.toThrow(
      "qoder stream-start timeout",
    );
    expect(dripped.body.locked).toBe(false);
  });

  it("replays complete first chunk before continuing normal stream", async () => {
    const first = JSON.stringify({ choices: [{ delta: { content: "first" } }] });
    const finish = JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
    const wrapped = await wrapQoderSSE(responseFromChunks([
      envelope(200, first),
      envelope(200, finish),
      envelope(200, "[DONE]"),
    ]), "qoder/auto");

    expect(wrapped.status).toBe(200);
    await expect(wrapped.text()).resolves.toContain(`data: ${first}\n\n`);
  });
});

describe("Qoder billing prefix boundaries", () => {
  const { wrapQoderSSE, isBillingBlock } = qoderExecutorInternals;

  it("matches only top-level billing fields", () => {
    expect(isBillingBlock(JSON.stringify({ code: "112" }))).toBe(true);
    expect(isBillingBlock(JSON.stringify({ pricingUrl: "https://qoder.sh/pricing" }))).toBe(true);
    expect(isBillingBlock(JSON.stringify({ message: 'ordinary text {"code":"112"}', nested: { pricingUrl: "x" } }))).toBe(false);
  });

  it("detects a billing envelope split across chunks", async () => {
    const body = JSON.stringify({ code: "112" });
    const frame = envelope(403, body);
    const wrapped = await wrapQoderSSE(responseFromChunks([frame.slice(0, 13), frame.slice(13)]), "qoder/auto");
    expect(wrapped.status).toBe(403);
  });

  it("caps inspection but replays bytes past the 64KiB inspect cap", async () => {
    const inner = JSON.stringify({ choices: [{ delta: { content: "ok" } }] });
    const marker = JSON.stringify({ choices: [{ delta: { content: "marker-past-cap" } }] });
    // SSE comment lines (": ...") are valid frames every SSE parser skips.
    // Padding past 64KiB with these (instead of raw non-SSE bytes) proves the
    // 64KiB inspect cap doesn't truncate or corrupt what actually gets
    // replayed downstream, without depending on malformed byte passthrough.
    const padding = ": pad\n".repeat(Math.ceil((70 * 1024) / 6));
    const first = `${envelope(200, inner)}${padding}${envelope(200, marker)}`;
    const wrapped = await wrapQoderSSE(responseFromChunks([first]), "qoder/auto");
    const output = await wrapped.text();
    expect(output).toContain(`data: ${inner}\n\n`);
    expect(output).toContain(`data: ${marker}\n\n`);
  });

  it("does not inspect a billing frame that starts at byte 65536", async () => {
    const billing = JSON.stringify({ code: "112", message: "must remain beyond peek" });
    // Exactly 64KiB of valid non-data SSE comments; billing starts at byte 65536,
    // past the inspection cap, so the wrapper must not special-case it as billing.
    const padding = ": x\n".repeat(16 * 1024);
    const wrapped = await wrapQoderSSE(responseFromChunks([
      `${padding}${envelope(403, billing)}`,
    ]), "qoder/auto");

    // Billing detection never fired: no synthetic 403 at the HTTP level.
    expect(wrapped.status).toBe(200);
    // The uninspected 403 envelope still fails through the normal
    // non-200-envelope path (generic stream error), not a raw passthrough
    // of the billing body.
    const output = await wrapped.text();
    expect(output).not.toContain(billing);
    expect(output).toContain("Qoder upstream stream failed");
  });

  it("releases upstream reader after a billing cancellation", async () => {
    const response = responseWithReader([envelope(403, JSON.stringify({ code: "112" }))]);
    await wrapQoderSSE(response, "qoder/auto");
    expect(response.body.locked).toBe(false);
  });

  it("releases upstream reader after normal drain and downstream cancellation", async () => {
    const normal = responseWithReader([envelope(200, JSON.stringify({ choices: [{ delta: { content: "ok" } }] })), envelope(200, "[DONE]")]);
    const wrapped = await wrapQoderSSE(normal, "qoder/auto");
    await wrapped.text();
    expect(normal.body.locked).toBe(false);

    const cancelled = responseWithReader([envelope(200, JSON.stringify({ choices: [{ delta: { content: "ok" } }] }))]);
    const cancelledWrapped = await wrapQoderSSE(cancelled, "qoder/auto");
    await cancelledWrapped.body.cancel("client gone");
    expect(cancelled.body.locked).toBe(false);
  });
});
