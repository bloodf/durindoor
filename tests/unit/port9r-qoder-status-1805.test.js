import { describe, expect, it } from "vitest";
import { __test__ } from "../../open-sse/executors/qoder.js";

describe("Qoder first-frame errors", () => {
  it.each([[401, 401], [429, 429], [700, 502]])("promotes status %s without exposing the body", async (status, expected) => {
    const frame = `data: ${JSON.stringify({ statusCodeValue: status, body: "private upstream details" })}\n\n`;
    const bytes = new TextEncoder().encode(frame);
    let cancelled = false;
    const response = new Response(new ReadableStream({
      start(controller) { controller.enqueue(bytes.subarray(0, 7)); controller.enqueue(bytes.subarray(7)); },
      cancel() { cancelled = true; },
    }));
    const result = await __test__.wrapQoderSSE(response, "qoder/auto");
    expect(result.status).toBe(expected);
    expect(await result.text()).not.toContain("private upstream details");
    expect(cancelled).toBe(true);
  });
});
