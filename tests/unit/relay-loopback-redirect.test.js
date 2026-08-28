import http from "http";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/models", () => ({ createProxyPool: vi.fn() }));

import { RELAY_WORKER_CODE } from "../../src/app/api/proxy-pools/cloudflare-deploy/route.js";
import { RELAY_FUNCTION_CODE } from "../../src/app/api/proxy-pools/vercel-deploy/route.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function relayRequest(target) {
  return new Request("https://relay.example.test/", {
    headers: {
      "x-relay-target": target,
      "x-relay-path": "/start",
    },
  });
}

async function importRelay(source) {
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server.address().port);
    });
  });
}

function close(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

async function expectRedirectRejected(source, getHandler) {
  let followed = 0;
  const upstream = http.createServer((request, response) => {
    if (request.url === "/followed") followed += 1;
    response.writeHead(request.url === "/start" ? 302 : 200, {
      location: "/followed",
    });
    response.end();
  });
  const port = await listen(upstream);

  try {
    const handler = getHandler(await importRelay(source));
    const response = await handler(relayRequest(`http://127.0.0.1:${port}`));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: "Upstream redirects are not allowed" });
    expect(followed).toBe(0);
  } finally {
    await close(upstream);
  }
}

describe("deployed outbound relays", () => {
  it("rejects Cloudflare upstream redirects without following them", async () => {
    await expectRedirectRejected(RELAY_WORKER_CODE, (worker) => (request) => worker.default.fetch(request, {}, {}));
  });

  it("rejects Vercel upstream redirects without following them", async () => {
    await expectRedirectRejected(RELAY_FUNCTION_CODE, (relay) => relay.default);
  });
});
