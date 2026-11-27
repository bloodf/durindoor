import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ proxyAwareFetch: vi.fn() }));
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: mocks.proxyAwareFetch }));

import { createCatalogCache } from "../../open-sse/services/catalogs/catalogCache.js";
import { clearKiroModelCache, resolveKiroModels } from "../../open-sse/services/catalogs/kiroModels.js";
import { clearLiveModelLimitsCache, getCachedLiveLimits, resolveLiveOpenAIModels } from "../../open-sse/services/liveModelLimits.js";

// [module name, directory under open-sse/services]. The catalog modules live in
// services/catalogs/; liveModelLimits stays at the services/ top level.
const CATALOG_MODULES = [
  ["qoderModels", "catalogs"],
  ["kimchiModels", "catalogs"],
  ["kiroModels", "catalogs"],
  ["cursorModels", "catalogs"],
  ["copilotModels", "catalogs"],
  ["ollamaCatalog", "catalogs"],
  ["openrouterCatalog", "catalogs"],
  ["clineModels", "catalogs"],
  ["clinepassModels", "catalogs"],
  ["commandcodeModels", "catalogs"],
  ["liveModelLimits", ""],
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

describe("live model limits cache", () => {
  const options = () => ({ endpoint: "https://catalog.example.test/v1/models", provider: "openai-compatible-x" });
  let fetchMock;

  beforeEach(() => {
    clearLiveModelLimitsCache();
    fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: "m1", context_length: 32_000 }] })));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shares one request and records limits for every waiting connection", async () => {
    const connections = [{ id: "one", apiKey: "k" }, { id: "two", apiKey: "k" }];

    const [first, second] = await Promise.all(connections.map((connection) => resolveLiveOpenAIModels(connection, options())));

    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    for (const connection of connections) {
      expect(getCachedLiveLimits("openai-compatible-x", "m1", connection)).toMatchObject({ contextWindow: 32_000 });
    }
  });

  it("records limits on a cache hit with the catalog's own expiry", async () => {
    await resolveLiveOpenAIModels({ id: "one", apiKey: "k" }, options());
    vi.setSystemTime(60_000);
    const late = { id: "late", apiKey: "k" };
    await resolveLiveOpenAIModels(late, options());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.setSystemTime(299_999);
    expect(getCachedLiveLimits("openai-compatible-x", "m1", late)).not.toBeNull();
    vi.setSystemTime(300_000);
    expect(getCachedLiveLimits("openai-compatible-x", "m1", late)).toBeNull();
  });

  it("remembers a failed catalog for five minutes", async () => {
    fetchMock.mockImplementation(async () => new Response("no", { status: 500 }));
    const connection = { id: "one", apiKey: "k" };

    expect(await resolveLiveOpenAIModels(connection, options())).toBeNull();
    vi.setSystemTime(299_999);
    expect(await resolveLiveOpenAIModels(connection, options())).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(300_000);
    await resolveLiveOpenAIModels(connection, options());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("catalog modules", () => {
  it.each(CATALOG_MODULES)("%s uses createCatalogCache", (name, dir) => {
    const source = readFileSync(new URL(`../../open-sse/services/${dir ? `${dir}/` : ""}${name}.js`, import.meta.url), "utf8");

    // The specifier is relative to the module: catalogCache.js is a sibling inside
    // services/catalogs/, one directory down for modules that stay at services/.
    const specifier = dir === "catalogs" ? "./catalogCache.js" : "./catalogs/catalogCache.js";
    expect(source).toContain(`import { createCatalogCache } from "${specifier}";`);
    expect(source).toMatch(/= createCatalogCache\(/);
    expect(source).not.toMatch(/\b(inflight|inFlight)\b/);
  });
});
