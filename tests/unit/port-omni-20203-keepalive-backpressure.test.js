import { describe, it, expect } from "vitest";
import { withEarlyStreamKeepalive } from "../../open-sse/utils/earlyStreamKeepalive.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe("OmniRoute #20203: early keepalive backpressure", () => {
  it("stops reading upstream while the client does not read, then delivers everything", async () => {
    let pulls = 0;
    const upstream = new ReadableStream({
      pull(controller) {
        pulls++;
        controller.enqueue(new TextEncoder().encode(`data: ${pulls}\n\n`));
        if (pulls === 50) controller.close();
      }
    });
    const slow = sleep(5).then(() => new Response(upstream, { headers: { "content-type": "text/event-stream" } }));
    const response = await withEarlyStreamKeepalive(slow, { thresholdMs: 0, intervalMs: 60_000 });
    await sleep(100);
    expect(pulls).toBeLessThan(5);
    expect(await response.text()).toContain("data: 50\n\n");
  });
});
