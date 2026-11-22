// A signed-in gemini.google.com/app answers with ~30 KB of response headers (rotated
// Set-Cookie values). undici's default 16 KB maxHeaderSize turned that into
// UND_ERR_HEADERS_OVERFLOW, so the Gemini Web cookie probe reported the provider as
// unreachable. Every DurinDoor dispatcher must accept browser-sized headers.
import { createServer } from "node:http";
import { Agent, fetch } from "undici";
import { describe, expect, it } from "vitest";
import { createGuardedProbeDispatcher } from "../../open-sse/utils/outboundUrlGuard.js";
import { getDirectDispatcherOptionsForTest } from "../../open-sse/utils/proxyFetch.js";

async function withBigHeaderServer(run) {
  const cookies = Array.from({ length: 20 }, (_, i) => `c${i}=${"x".repeat(1500)}; Path=/`);
  const server = createServer((_req, res) => {
    res.setHeader("Set-Cookie", cookies);
    res.end("ok");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}/`);
  } finally {
    server.close();
  }
}

describe("large upstream response headers", () => {
  it("direct dispatcher options accept ~30 KB of response headers", async () => {
    await withBigHeaderServer(async (url) => {
      const agent = new Agent(getDirectDispatcherOptionsForTest());
      try {
        const response = await fetch(url, { dispatcher: agent });
        expect(response.status).toBe(200);
        expect(await response.text()).toBe("ok");
      } finally {
        await agent.close();
      }
    });
  });

  it("guarded probe dispatcher (provider cookie validation) accepts ~30 KB of response headers", async () => {
    await withBigHeaderServer(async (url) => {
      const dispatcher = createGuardedProbeDispatcher("none");
      try {
        const response = await fetch(url, { dispatcher });
        expect(response.status).toBe(200);
        expect(await response.text()).toBe("ok");
      } finally {
        await dispatcher.close();
      }
    });
  });
});
