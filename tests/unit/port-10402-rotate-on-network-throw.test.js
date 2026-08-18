import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

vi.mock("undici", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fetch: (...args) => fetchMock(...args) };
});

import { MimocodeExecutor } from "../../open-sse/executors/mimocode.js";

function makeJwt(expSec = Math.floor(Date.now() / 1000) + 3600) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ exp: expSec })).toString("base64url");
  return `${header}.${payload}.sig`;
}

function jsonResponse(data, { status = 200 } = {}) {
  return new Response(JSON.stringify(data), { status });
}

function makeCredentials(fingerprints, accountProxies = []) {
  return {
    providerSpecificData: { fingerprints, accountProxies },
  };
}

function buildExecutor(fingerprints, accountProxies = []) {
  const executor = new MimocodeExecutor();
  executor.accounts.splice(0, executor.accounts.length);
  executor.nextAccountIdx = 0;
  executor.proxyUrlMap.clear();
  executor.syncAccountsFromCredentials(makeCredentials(fingerprints, accountProxies));
  return executor;
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(jsonResponse({ jwt: makeJwt() }));
});

describe("port-10402 rotate-on-network-throw: MimocodeExecutor.execute", () => {
  it("rotates to the next account on 429 even when the account has no proxy", async () => {
    const executor = buildExecutor(["fp-a", "fp-b"]);
    fetchMock
      .mockReset()
      .mockResolvedValueOnce(jsonResponse({ jwt: makeJwt() }))
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(jsonResponse({ jwt: makeJwt() }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const { response } = await executor.execute({
      model: "mimo-auto",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: false,
      credentials: makeCredentials(["fp-a", "fp-b"]),
    });

    expect(response.status).toBe(200);
    expect(executor.accounts[0].cooldownUntil).toBeGreaterThan(0);
  });

  it("rotates to the next account on a network throw when the account has a dedicated proxy", async () => {
    const proxies = [
      { fingerprint: "fp-a", proxy: { type: "http", host: "proxy-a.test", port: 8080 } },
      { fingerprint: "fp-b", proxy: { type: "http", host: "proxy-b.test", port: 8080 } },
    ];
    const credentials = makeCredentials(["fp-a", "fp-b"], proxies);
    const executor = buildExecutor(["fp-a", "fp-b"], proxies);

    const networkError = new TypeError("fetch failed: ECONNRESET");
    fetchMock
      .mockReset()
      .mockResolvedValueOnce(jsonResponse({ jwt: makeJwt() }))
      .mockRejectedValueOnce(networkError)
      .mockResolvedValueOnce(jsonResponse({ jwt: makeJwt() }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const { response } = await executor.execute({
      model: "mimo-auto",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: false,
      credentials,
    });

    expect(response.status).toBe(200);
    expect(executor.accounts[0].consecutiveFails).toBeGreaterThanOrEqual(1);
  });

  it("does NOT rotate to the next account on a network throw when the account shares the default egress (no proxy)", async () => {
    const executor = buildExecutor(["fp-a", "fp-b"]);

    const networkError = new TypeError("fetch failed: ECONNRESET");
    fetchMock
      .mockReset()
      .mockResolvedValueOnce(jsonResponse({ jwt: makeJwt() }))
      .mockRejectedValueOnce(networkError);

    const { response } = await executor.execute({
      model: "mimo-auto",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: false,
      credentials: makeCredentials(["fp-a", "fp-b"]),
    });

    expect(response.status).toBe(502);
    expect(executor.accounts[0].cooldownUntil).toBe(0);
    expect(executor.accounts[1].cooldownUntil).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does NOT rotate on 4xx request errors (preserves 9router #3181 contract)", async () => {
    const executor = buildExecutor(["fp-a", "fp-b"]);

    fetchMock
      .mockReset()
      .mockResolvedValueOnce(jsonResponse({ jwt: makeJwt() }))
      .mockResolvedValueOnce(new Response("bad request", { status: 400 }));

    const { response } = await executor.execute({
      model: "mimo-auto",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: false,
      credentials: makeCredentials(["fp-a", "fp-b"]),
    });

    expect(response.status).toBe(400);
    expect(executor.accounts[0].cooldownUntil).toBe(0);
  });
});
