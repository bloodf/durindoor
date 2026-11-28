// #2034 staged AI Horde image catalog against a closed mock transport. No Horde
// host is contacted; passing here proves the cache state machine only.
import { describe, expect, it } from "vitest";
import {
  AI_HORDE_CATALOG_URL,
  AI_HORDE_CLIENT_AGENT,
  HordeImageCatalog,
  parseHordeImageModels,
} from "../../open-sse/services/catalogs/aihordeImageCatalog.js";

const ROWS = [
  { name: "stable_diffusion", type: "image", count: 3, queued: 10, eta: 4.6, performance: 1.5, jobs: 2 },
  { name: "AlbedoBase XL (SDXL)", type: "image", count: 1 },
  { name: "Idle Model", type: "image", count: 0 },
  { name: "Text Model", type: "text", count: 9 },
  { name: "", count: 4 },
  "junk",
];

const json = (value, init = {}) => new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" }, ...init });

function mockTransport(answer = () => json(ROWS)) {
  const calls = [];
  const transport = (url, init) => {
    calls.push({ url, init });
    return Promise.resolve().then(() => answer(calls.length, init));
  };
  return { calls, transport };
}

function clock(start = 1_000_000) {
  const state = { t: start };
  return { now: () => state.t, advance: (ms) => { state.t += ms; } };
}

describe("parseHordeImageModels", () => {
  it("keeps image rows with workers, exact names, sorted", () => {
    expect(parseHordeImageModels(ROWS).map((m) => m.name)).toEqual(["AlbedoBase XL (SDXL)", "stable_diffusion"]);
    expect(parseHordeImageModels(ROWS)[1]).toEqual({ name: "stable_diffusion", count: 3, queued: 10, eta: 4, performance: 1.5, jobs: 2 });
  });

  it("refuses a non-array payload", () => {
    expect(() => parseHordeImageModels({ models: [] })).toThrow("must be a JSON array");
  });
});

describe("HordeImageCatalog", () => {
  it("cold: one anonymous GET of the public image catalog", async () => {
    const { calls, transport } = mockTransport();
    const catalog = new HordeImageCatalog({ transport });
    expect(catalog.hasSnapshot()).toBe(false);
    await catalog.ensureFresh();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://aihorde.net/api/v2/status/models?type=image");
    expect(calls[0].url).toBe(AI_HORDE_CATALOG_URL);
    expect(calls[0].init.method).toBe("GET");
    expect(calls[0].init.headers).toEqual({ Accept: "application/json", "Client-Agent": AI_HORDE_CLIENT_AGENT });
    expect(AI_HORDE_CLIENT_AGENT).toMatch(/^DurinDoor:[^:]+:https:\/\/github\.com\/bloodf\/durindoor$/);
    expect(catalog.hasSnapshot()).toBe(true);
    expect(catalog.isServed("stable_diffusion")).toBe(true);
    expect(catalog.isServed("Idle Model")).toBe(false);
    expect(catalog.isServed("Text Model")).toBe(false);
    expect(catalog.isServed("unknown")).toBe(false);
    expect(Object.keys(catalog.snapshot).sort()).toEqual(["lastError", "models", "updatedAt"]);
    expect(JSON.stringify(catalog.snapshot)).not.toMatch(/apikey|authorization|0000000000/i);
  });

  it("warm: no fetch inside the 30 s window, a refresh after it", async () => {
    const { calls, transport } = mockTransport();
    const time = clock();
    const catalog = new HordeImageCatalog({ transport, now: time.now });
    expect(catalog.pollMs).toBe(30_000);
    expect(catalog.fetchTimeoutMs).toBe(15_000);
    await catalog.ensureFresh();
    time.advance(29_999);
    await catalog.ensureFresh();
    expect(calls).toHaveLength(1);
    time.advance(1);
    await catalog.ensureFresh();
    expect(calls).toHaveLength(2);
  });

  it("concurrent callers share one blocking refresh", async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const { calls, transport } = mockTransport(async () => { await gate; return json(ROWS); });
    const catalog = new HordeImageCatalog({ transport });
    const waits = [catalog.ensureFresh(), catalog.ensureFresh(), catalog.ensureFresh()];
    await Promise.resolve();
    expect(catalog.hasSnapshot()).toBe(false);
    release();
    await Promise.all(waits);
    expect(calls).toHaveLength(1);
    expect(catalog.isServed("stable_diffusion")).toBe(true);
  });

  it("cold failure leaves no snapshot and invents no model", async () => {
    const { transport } = mockTransport(() => json({ message: "down" }, { status: 500 }));
    const catalog = new HordeImageCatalog({ transport });
    await catalog.ensureFresh();
    expect(catalog.hasSnapshot()).toBe(false);
    expect(catalog.isServed("stable_diffusion")).toBe(false);
    expect(catalog.snapshot).toEqual({ models: [], updatedAt: null, lastError: "Horde catalog HTTP 500" });
  });

  it("warm failure keeps the last successful snapshot, marks it stale and retries next time", async () => {
    let fail = false;
    const { calls, transport } = mockTransport(() => (fail ? Promise.reject(new Error("socket hang up 10.0.0.7")) : json(ROWS)));
    const time = clock();
    const catalog = new HordeImageCatalog({ transport, now: time.now });
    await catalog.ensureFresh();
    const updatedAt = catalog.snapshot.updatedAt;
    fail = true;
    time.advance(30_000);
    await catalog.ensureFresh();
    expect(catalog.stale).toBe(true);
    expect(catalog.snapshot.updatedAt).toBe(updatedAt);
    expect(catalog.snapshot.lastError).toBe("Horde catalog request failed");
    expect(catalog.isServed("stable_diffusion")).toBe(true);
    await catalog.ensureFresh();
    expect(calls).toHaveLength(3);
    fail = false;
    await catalog.ensureFresh();
    expect(catalog.stale).toBe(false);
    expect(catalog.snapshot.lastError).toBeNull();
  });

  it.each([
    ["non-array JSON", () => json({ models: ROWS }), "Horde model catalog must be a JSON array"],
    ["non-JSON body", () => new Response("<html>", { status: 200 }), "Horde catalog returned an unreadable payload"],
    ["redirect", () => new Response(null, { status: 302, headers: { Location: "https://evil.example/" } }), "Horde catalog HTTP 302"],
    ["oversized body", () => new Response("[]", { status: 200, headers: { "Content-Length": String(5 * 1024 * 1024) } }), "Horde catalog returned an unreadable payload"],
  ])("invalid catalog (%s) is a failure, not an entitlement", async (_, answer, message) => {
    const { calls, transport } = mockTransport(answer);
    const catalog = new HordeImageCatalog({ transport });
    await catalog.ensureFresh();
    expect(calls).toHaveLength(1);
    expect(catalog.hasSnapshot()).toBe(false);
    expect(catalog.snapshot.lastError).toBe(message);
  });

  it("zero-worker rows are never served", async () => {
    const { transport } = mockTransport(() => json([{ name: "stable_diffusion", count: 0 }, { name: "Only", count: "2" }]));
    const catalog = new HordeImageCatalog({ transport });
    await catalog.ensureFresh();
    expect(catalog.hasSnapshot()).toBe(true);
    expect(catalog.listModels().map((m) => m.name)).toEqual(["Only"]);
    expect(catalog.isServed("stable_diffusion")).toBe(false);
  });

  it("the shared refresh is bounded by its own deadline", async () => {
    const transport = (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
    });
    const catalog = new HordeImageCatalog({ transport, fetchTimeoutMs: 20 });
    await catalog.ensureFresh();
    expect(catalog.hasSnapshot()).toBe(false);
    expect(catalog.snapshot.lastError).toBe("Horde catalog timed out");
  });

  it("a caller abort ends only that caller's wait, not the shared refresh", async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let transportSignal;
    const { calls, transport } = mockTransport(async (_n, init) => { transportSignal = init.signal; await gate; return json(ROWS); });
    const catalog = new HordeImageCatalog({ transport });
    const aborter = new AbortController();
    const first = catalog.ensureFresh(undefined, { signal: aborter.signal });
    const second = catalog.ensureFresh();
    await Promise.resolve();
    aborter.abort();
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    expect(transportSignal.aborted).toBe(false);
    release();
    await second;
    expect(calls).toHaveLength(1);
    expect(catalog.isServed("stable_diffusion")).toBe(true);
  });

  it("an already-aborted caller starts nothing", async () => {
    const { calls, transport } = mockTransport();
    const catalog = new HordeImageCatalog({ transport });
    await expect(catalog.ensureFresh(undefined, { signal: AbortSignal.abort() })).rejects.toBeTruthy();
    expect(calls).toHaveLength(0);
  });
});
