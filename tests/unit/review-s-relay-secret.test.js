import http from "http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createProxyPool: vi.fn(),
  getProxyPoolById: vi.fn(),
  isOperatorRequest: vi.fn(),
  getProxyPools: vi.fn(),
  getProviderConnections: vi.fn(),
}));

vi.mock("@/models", () => ({
  createProxyPool: mocks.createProxyPool,
  getProxyPoolById: mocks.getProxyPoolById,
  getProxyPools: mocks.getProxyPools,
  getProviderConnections: mocks.getProviderConnections,
  updateProxyPool: vi.fn(),
  deleteProxyPool: vi.fn(),
}));

vi.mock("@/dashboardGuard", () => ({
  isOperatorRequest: mocks.isOperatorRequest,
}));

import {
  buildRelayFunctionCode,
  buildRelayWorkerCode,
  generateRelaySecret,
} from "../../src/app/api/proxy-pools/relaySource.js";
import { RELAY_WORKER_CODE } from "../../src/app/api/proxy-pools/cloudflare-deploy/route.js";
import { RELAY_FUNCTION_CODE } from "../../src/app/api/proxy-pools/vercel-deploy/route.js";
import { resolveConnectionProxyConfig } from "../../src/lib/network/connectionProxy.js";
import {
  __setOriginalFetchForTesting,
  proxyAwareFetch,
} from "../../open-sse/utils/proxyFetch.js";
import { REDACTED_SECRET } from "../../src/shared/utils/secretRedaction.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

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

async function importRelay(source) {
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

describe("review-s-relay-secret (#2211)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isOperatorRequest.mockResolvedValue(false);
    mocks.getProviderConnections.mockResolvedValue([]);
  });

  it("generates a 32-byte hex deploy secret", () => {
    const secret = generateRelaySecret();
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    expect(generateRelaySecret()).not.toBe(secret);
  });

  it("rejects Cloudflare and Vercel relays without a matching x-relay-secret", async () => {
    const secret = "a".repeat(64);
    const upstream = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
    const port = await listen(upstream);

    try {
      for (const [label, source, getHandler] of [
        ["cloudflare", buildRelayWorkerCode(secret), (mod) => (req) => mod.default.fetch(req, {}, {})],
        ["vercel", buildRelayFunctionCode(secret), (mod) => mod.default],
      ]) {
        const handler = getHandler(await importRelay(source));
        const denied = await handler(
          new Request("https://relay.example.test/", {
            headers: {
              "x-relay-target": `http://127.0.0.1:${port}`,
              "x-relay-path": "/",
            },
          })
        );
        expect(denied.status, label).toBe(401);

        const wrong = await handler(
          new Request("https://relay.example.test/", {
            headers: {
              "x-relay-target": `http://127.0.0.1:${port}`,
              "x-relay-path": "/",
              "x-relay-secret": "b".repeat(64),
            },
          })
        );
        expect(wrong.status, label).toBe(401);

        let forwardedSecret = "unset";
        const capturing = http.createServer((req, res) => {
          forwardedSecret = req.headers["x-relay-secret"] || null;
          res.writeHead(200, { "content-type": "application/json" });
          res.end("{}");
        });
        const capturePort = await listen(capturing);
        try {
          const ok = await handler(
            new Request("https://relay.example.test/", {
              headers: {
                "x-relay-target": `http://127.0.0.1:${capturePort}`,
                "x-relay-path": "/",
                "x-relay-secret": secret,
              },
            })
          );
          expect(ok.status, label).toBe(200);
          expect(forwardedSecret, `${label} must strip x-relay-secret`).toBe(null);
        } finally {
          await close(capturing);
        }
      }
    } finally {
      await close(upstream);
    }
  });

  it("keeps empty-secret fixture relays open (pre-secret pools)", async () => {
    expect(RELAY_WORKER_CODE).toContain('EXPECTED_SECRET = ""');
    expect(RELAY_FUNCTION_CODE).toContain('EXPECTED_SECRET = ""');

    const upstream = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
    const port = await listen(upstream);
    try {
      const worker = await importRelay(RELAY_WORKER_CODE);
      const response = await worker.default.fetch(
        new Request("https://relay.example.test/", {
          headers: {
            "x-relay-target": `http://127.0.0.1:${port}`,
            "x-relay-path": "/",
          },
        }),
        {},
        {}
      );
      expect(response.status).toBe(200);
    } finally {
      await close(upstream);
    }
  });

  it("sends x-relay-secret from proxyAwareFetch when the pool has a stored secret", async () => {
    const secret = "c".repeat(64);
    let seen = {};
    const restore = __setOriginalFetchForTesting(async (_url, init) => {
      seen = Object.fromEntries(new Headers(init.headers).entries());
      return new Response("{}", { status: 200 });
    });

    try {
      await proxyAwareFetch(
        "https://api.example.test/v1/chat",
        { method: "POST", headers: { authorization: "Bearer tok" }, body: "{}" },
        { vercelRelayUrl: "https://relay.example.test/", relaySecret: secret }
      );
      expect(seen["x-relay-secret"]).toBe(secret);
      expect(seen["x-relay-target"]).toBe("https://api.example.test");
    } finally {
      restore();
    }
  });

  it("does not send x-relay-secret when the pool has no stored secret", async () => {
    let seen = {};
    const restore = __setOriginalFetchForTesting(async (_url, init) => {
      seen = Object.fromEntries(new Headers(init.headers).entries());
      return new Response("{}", { status: 200 });
    });

    try {
      await proxyAwareFetch(
        "https://api.example.test/v1/chat",
        { method: "GET" },
        { vercelRelayUrl: "https://relay.example.test/" }
      );
      expect(seen["x-relay-secret"]).toBeUndefined();
    } finally {
      restore();
    }
  });

  it("embeds the relay secret for credential hops and strips it before fetch", async () => {
    const secret = "d".repeat(64);
    mocks.getProxyPoolById.mockResolvedValue({
      id: "relay-1",
      isActive: true,
      type: "cloudflare",
      proxyUrl: "https://relay.example.test",
      relaySecret: secret,
    });

    const resolved = await resolveConnectionProxyConfig({ proxyPoolId: "relay-1" });
    expect(resolved.relaySecret).toBe(secret);
    expect(resolved.proxyPool?.relaySecret).toBeUndefined();
    expect(resolved.vercelRelayUrl).toContain(`${secret}@`);

    let fetchUrl = "";
    let seen = {};
    const restore = __setOriginalFetchForTesting(async (url, init) => {
      fetchUrl = String(url);
      seen = Object.fromEntries(new Headers(init.headers).entries());
      return new Response("{}", { status: 200 });
    });

    try {
      await proxyAwareFetch(
        "https://api.example.test/v1",
        { method: "GET" },
        { vercelRelayUrl: resolved.vercelRelayUrl }
      );
      expect(seen["x-relay-secret"]).toBe(secret);
      expect(fetchUrl).toBe("https://relay.example.test/");
      expect(fetchUrl).not.toContain(secret);
    } finally {
      restore();
    }
  });

  it("stores relaySecret on deploy and redacts it from pool API responses", async () => {
    const secret = generateRelaySecret();
    mocks.createProxyPool.mockImplementation(async (data) => ({
      id: "new-relay",
      name: data.name,
      proxyUrl: data.proxyUrl,
      type: data.type,
      relaySecret: data.relaySecret,
      isActive: true,
    }));

    globalThis.fetch = vi.fn(async (url, init) => {
      const href = String(url);
      if (href.includes("/workers/scripts/") && init?.method === "PUT") {
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      if (href.endsWith("/subdomain") && init?.method === "POST") {
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      if (href.includes("/workers/subdomain") && (!init?.method || init.method === "GET")) {
        return new Response(JSON.stringify({ result: { subdomain: "acct" } }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });

    const { POST } = await import("../../src/app/api/proxy-pools/cloudflare-deploy/route.js");
    const deployRes = await POST(
      new Request("http://localhost/api/proxy-pools/cloudflare-deploy", {
        method: "POST",
        body: JSON.stringify({
          accountId: "acct",
          apiToken: "tok",
          projectName: "relay-test",
        }),
      })
    );
    const deployBody = await deployRes.json();
    expect(deployRes.status).toBe(201);
    expect(mocks.createProxyPool).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "cloudflare",
        relaySecret: expect.stringMatching(/^[0-9a-f]{64}$/),
      })
    );
    expect(deployBody.proxyPool.relaySecret).toBe(REDACTED_SECRET);
    expect(JSON.stringify(deployBody)).not.toContain(
      mocks.createProxyPool.mock.calls[0][0].relaySecret
    );

    mocks.getProxyPools.mockResolvedValue([
      {
        id: "new-relay",
        name: "relay-test",
        proxyUrl: "https://relay-test.acct.workers.dev",
        relaySecret: secret,
      },
    ]);
    const { GET } = await import("../../src/app/api/proxy-pools/route.js");
    const listed = await (await GET(new Request("http://localhost/api/proxy-pools"))).json();
    expect(listed.proxyPools[0].relaySecret).toBe(REDACTED_SECRET);
    expect(JSON.stringify(listed)).not.toContain(secret);
  });

  it("documents that Vercel SSO stays off because the relay secret gates access", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(
        new URL("../../src/app/api/proxy-pools/vercel-deploy/route.js", import.meta.url),
        "utf8"
      )
    );
    expect(source).toMatch(/ssoProtection:\s*null/);
    expect(source).toMatch(/relaySecret/);
    expect(source.toLowerCase()).toMatch(/gates|gate/);
  });
});
