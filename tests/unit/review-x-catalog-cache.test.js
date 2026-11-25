import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ proxyAwareFetch: vi.fn() }));
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: mocks.proxyAwareFetch }));

import { createCatalogCache } from "../../open-sse/services/catalogCache.js";
import { clearKiroModelCache, resolveKiroModels } from "../../open-sse/services/kiroModels.js";

const CATALOG_MODULES = [
  "qoderModels",
  "kimchiModels",
  "kiroModels",
  "cursorModels",
  "copilotModels",
  "ollamaCatalog",
  "openrouterCatalog",
  "clineModels",
  "clinepassModels",
  "commandcodeModels",
];

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(0);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("createCatalogCache", () => {
  it("shares one in-flight load between concurrent callers", async () => {
    const gate = deferred();
    const loader = vi.fn(() => gate.promise);
    const cache = createCatalogCache({ ttlMs: 100 });

    const first = cache.load("a", loader);
    const second = cache.load("a", loader);
    gate.resolve("catalog");

    expect(await Promise.all([first, second])).toEqual(["catalog", "catalog"]);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("keeps forced, private and differently keyed loads separate", async () => {
    const loader = vi.fn(async () => "catalog");
    const cache = createCatalogCache({ ttlMs: 100 });

    await Promise.all([
      cache.load("a", loader),
      cache.load("a", loader, { force: true }),
      cache.load("a", loader, { flightKey: null }),
      cache.load("a", loader, { flightKey: "other-route" }),
      cache.load("b", loader),
    ]);

    expect(loader).toHaveBeenCalledTimes(5);
  });

  it("reloads after the TTL expires", async () => {
    const loader = vi.fn(async () => "catalog");
    const cache = createCatalogCache({ ttlMs: 100 });

    await cache.load("a", loader);
    vi.setSystemTime(99);
    await cache.load("a", loader);
    expect(loader).toHaveBeenCalledTimes(1);

    vi.setSystemTime(100);
    await cache.load("a", loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("remembers a failed lookup for the negative TTL only", async () => {
    const loader = vi.fn(async () => null);
    const cache = createCatalogCache({ ttlMs: 100, negativeTtlMs: 10 });

    expect(await cache.load("a", loader)).toBeNull();
    vi.setSystemTime(9);
    expect(await cache.load("a", loader)).toBeNull();
    expect(loader).toHaveBeenCalledTimes(1);

    vi.setSystemTime(10);
    await cache.load("a", loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("caches nothing for a loader that throws", async () => {
    const loader = vi.fn(async () => { throw new Error("offline"); });
    const cache = createCatalogCache({ ttlMs: 100, negativeTtlMs: 10 });

    await expect(cache.load("a", loader)).rejects.toThrow("offline");
    await expect(cache.load("a", loader)).rejects.toThrow("offline");
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("stores nothing without a TTL", async () => {
    const loader = vi.fn(async () => "catalog");
    const cache = createCatalogCache();

    await cache.load("a", loader);
    await cache.load("a", loader);

    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("builds keys with keyFn", () => {
    expect(createCatalogCache({ keyFn: (a, b) => `${a}:${b}` }).keyFor("x", "y")).toBe("x:y");
  });
});

describe("catalog module dedup", () => {
  const credentials = () => ({
    accessToken: "token",
    providerSpecificData: { profileArn: "arn:aws:codewhisperer:us-east-1:1:profile/x" },
  });

  beforeEach(() => {
    clearKiroModelCache();
    mocks.proxyAwareFetch.mockReset();
    mocks.proxyAwareFetch.mockImplementation(async () =>
      new Response(JSON.stringify({ models: [{ modelId: "claude-x" }] })));
  });

  it("sends one request for concurrent identical Kiro lookups", async () => {
    const [first, second] = await Promise.all([
      resolveKiroModels(credentials()),
      resolveKiroModels(credentials()),
    ]);

    expect(second.models).toEqual(first.models);
    expect(mocks.proxyAwareFetch).toHaveBeenCalledTimes(1);
  });

  it("does not share a request across egress routes or abortable callers", async () => {
    await Promise.all([
      resolveKiroModels(credentials()),
      resolveKiroModels(credentials(), { proxyOptions: { connectionProxyUrl: "http://proxy:1" } }),
      resolveKiroModels(credentials(), { signal: new AbortController().signal }),
    ]);

    expect(mocks.proxyAwareFetch).toHaveBeenCalledTimes(3);
  });
});

describe("catalog modules", () => {
  it.each(CATALOG_MODULES)("%s uses createCatalogCache", (name) => {
    const source = readFileSync(new URL(`../../open-sse/services/${name}.js`, import.meta.url), "utf8");

    expect(source).toContain('import { createCatalogCache } from "./catalogCache.js";');
    expect(source).toMatch(/= createCatalogCache\(/);
    expect(source).not.toMatch(/\b(inflight|inFlight)\b/);
  });
});
