import { describe, expect, it } from "vitest";
import { applyResponseMasking } from "../../open-sse/services/responseMasking.js";

const CHUNK = "x".repeat(115);

describe("response masking SSE scan performance", () => {
  it("scans many frame-less chunks incrementally and preserves their content", async () => {
    const chunks = 8000;
    let sent = 0;
    const body = new ReadableStream({
      pull(controller) {
        if (sent === chunks) return controller.close();
        controller.enqueue(new TextEncoder().encode(CHUNK));
        sent++;
      },
    });
    const result = {
      success: true,
      response: new Response(body, { headers: { "content-type": "text/event-stream" } }),
    };
    const start = performance.now();
    const masked = await applyResponseMasking(result, { mode: "mask" });
    const output = await masked.response.text();
    const elapsed = performance.now() - start;

    expect(output).toBe(`${CHUNK.repeat(chunks)}\n\n`);
    expect(elapsed).toBeLessThan(1500);
  });
});
