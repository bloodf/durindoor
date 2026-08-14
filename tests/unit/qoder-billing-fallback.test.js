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
