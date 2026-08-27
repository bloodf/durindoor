import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/models", () => ({ createProxyPool: vi.fn() }));

import { RELAY_WORKER_CODE } from "../../src/app/api/proxy-pools/cloudflare-deploy/route.js";
import { RELAY_FUNCTION_CODE } from "../../src/app/api/proxy-pools/vercel-deploy/route.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function relayRequest() {
  return new Request("https://relay.example.test/", {
    headers: {
      "x-relay-target": "https://provider.example.test",
      "x-relay-path": "/start",
    },
  });
}

async function importRelay(source) {
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

describe("deployed outbound relays", () => {
  it("makes Cloudflare upstream redirects observable instead of following them", async () => {
    const upstreamFetch = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: "http://127.0.0.1/" } }));
    globalThis.fetch = upstreamFetch;
    const worker = (await importRelay(RELAY_WORKER_CODE)).default;

    const response = await worker.fetch(relayRequest(), {}, {});

    expect(response.status).toBe(302);
    expect(upstreamFetch).toHaveBeenCalledWith(
      "https://provider.example.test/start",
      expect.objectContaining({ redirect: "error" }),
    );
  });

  it("makes Vercel upstream redirects observable instead of following them", async () => {
    const upstreamFetch = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: "http://127.0.0.1/" } }));
    globalThis.fetch = upstreamFetch;
    const handler = (await importRelay(RELAY_FUNCTION_CODE)).default;

    const response = await handler(relayRequest());

    expect(response.status).toBe(302);
    expect(upstreamFetch).toHaveBeenCalledWith(
      "https://provider.example.test/start",
      expect.objectContaining({ redirect: "error" }),
    );
  });
});
