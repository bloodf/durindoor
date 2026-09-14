// These contracts run with root + tests dependencies only. The shared Vitest
// config and the CLI alias loader must use the website's static Kimchi UA stub.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createRouter } from "../../website/src/mock/router.js";
import { toResponse } from "../../website/src/mock/http.js";
import { registerAll } from "../../website/src/mock/handlers/index.js";
import { installMockNetwork } from "../../website/src/mock/install.js";
import { resetDemoData, store } from "../../website/src/mock/store.js";
import { runSmoke } from "../../website/scripts/mock-smoke.mjs";

const installed = Symbol.for("durindoor.demo.network");
const siteRoot = fileURLToPath(new URL("../../website/", import.meta.url));
const transferPath = "/api/settings/database/selective";
let router;
let temporaryDirectory;

function browserStorage() {
  const entries = new Map();
  return {
    get length() { return entries.size; },
    key: (index) => [...entries.keys()][index] ?? null,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, String(value)),
    removeItem: (key) => entries.delete(key),
  };
}

async function settle(promise) {
  await vi.runAllTimersAsync();
  return promise;
}

async function request(method, path, body, status = 200) {
  const url = new URL(path, "https://demo.local");
  const found = router.match(method, url.pathname);
  expect(found, `${method} ${path}`).not.toBeNull();
  const result = await settle(Promise.resolve(found.route.handler({ method, url, params: found.params, query: Object.fromEntries(url.searchParams), searchParams: url.searchParams, body })));
  const response = toResponse(result);
  expect(response.status, `${method} ${path}`).toBe(status);
  return response.json();
}

function bundleFor(rows) {
  return { format: "durindoor-selective-transfer", version: 1, providerConnections: rows, combos: [] };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("localStorage", browserStorage());
  resetDemoData();
  router = createRouter();
  registerAll(router, { store, external: () => {} });
});

afterEach(() => {
  resetDemoData();
  delete globalThis[installed];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true });
  temporaryDirectory = undefined;
});

describe("website persisted mock consumers", () => {
  it("reads created, renamed and deleted accounts in key options and scope validation", async () => {
    const { connection } = await request("POST", "/api/providers", { provider: "groq", name: "Added account", apiKey: "demo-key" }, 201);
    await request("PATCH", `/api/providers/${connection.id}`, { name: "Renamed account" });
    const options = (await request("GET", "/api/keys")).providerConnections;
    expect(options.find((row) => row.id === connection.id)).toMatchObject({ name: "Renamed account", provider: "groq" });
    const key = await request("POST", "/api/keys", { name: "Scoped key", providerConnectionIds: [connection.id] }, 201);
    expect((await request("GET", `/api/keys/${key.id}`)).key.providerConnectionIds).toEqual([connection.id]);
    await request("DELETE", `/api/providers/${connection.id}`);
    expect((await request("GET", "/api/keys")).providerConnections.some((row) => row.id === connection.id)).toBe(false);
    await request("PATCH", `/api/keys/${key.id}`, { providerConnectionIds: [connection.id] }, 400);
    await request("POST", "/api/keys", { name: "Stale scope", providerConnectionIds: [connection.id] }, 400);
  });

  it("upserts selective providers, preserves private state, and exports the current catalog", async () => {
    const existing = store.list("providers.connections")[0];
    store.patch("providers.connections", existing.id, { apiKey: "private-local-secret", demoQuota: { credit: 3 } });
    const updated = { id: existing.id, provider: existing.provider, name: "Imported rename", priority: 3, isActive: false };
    const added = { id: "conn-imported", provider: "groq", name: "Imported new", authType: "apikey", priority: 2, isActive: true };
    const bundle = bundleFor([updated, added]);
    expect((await request("POST", transferPath, { action: "preview", bundle })).providerConnections.map((row) => row.action)).toEqual(["update", "create"]);
    expect((await request("POST", transferPath, { action: "apply", bundle })).imported).toEqual({ providers: 2, combos: 0 });
    expect(store.find("providers.connections", existing.id)).toMatchObject({ apiKey: "private-local-secret", demoQuota: { credit: 3 }, name: "Imported rename" });
    expect((await request("GET", `/api/providers/${added.id}`)).connection.name).toBe(added.name);
    expect((await request("POST", transferPath, { action: "catalog" })).providers).toContainEqual({ id: added.id, name: added.name });
    const exported = await request("POST", transferPath, { action: "export", selection: { providers: [existing.id, added.id] } });
    expect(exported.providerConnections.find((row) => row.id === existing.id)).toMatchObject(updated);
    expect(exported.providerConnections.find((row) => row.id === added.id)).toEqual(added);
    expect(JSON.stringify(exported)).not.toContain("private-local-secret");
    expect(JSON.stringify(exported)).not.toContain("demoQuota");
    expect((await request("POST", transferPath, { action: "preview", bundle })).providerConnections.map((row) => row.action)).toEqual(["update", "update"]);
    expect((await request("GET", "/api/settings/database")).providerConnections).toContainEqual(added);
  });

  it("rejects invalid bundles before any provider mutation", async () => {
    const before = structuredClone(store.list("providers.connections"));
    const bundle = bundleFor([{ id: "conn-valid", provider: "groq", name: "Valid first" }, { id: "conn-invalid", name: "Missing provider" }]);
    await request("POST", transferPath, { action: "apply", bundle }, 400);
    expect(store.list("providers.connections")).toEqual(before);
  });

  it("blocks pool deletion only while live accounts remain bound, including disabled accounts", async () => {
    const { proxyPool } = await request("POST", "/api/proxy-pools", { name: "New pool", proxyUrl: "http://localhost:8080" }, 201);
    const [first, second] = store.list("providers.connections");
    await request("PATCH", `/api/providers/${first.id}`, { proxyPoolId: proxyPool.id, isActive: false });
    await request("PATCH", `/api/providers/${second.id}`, { proxyPoolId: proxyPool.id });
    const usage = async () => (await request("GET", "/api/proxy-pools?includeUsage=true")).proxyPools.find((pool) => pool.id === proxyPool.id).boundConnectionCount;
    expect(await usage()).toBe(2);
    expect((await request("DELETE", `/api/proxy-pools/${proxyPool.id}`, undefined, 409)).boundConnectionCount).toBe(2);
    await request("PATCH", `/api/providers/${first.id}`, { proxyPoolId: "__none__" });
    expect(await usage()).toBe(1);
    await request("DELETE", `/api/providers/${second.id}`);
    expect(await usage()).toBe(0);
    await request("DELETE", `/api/proxy-pools/${proxyPool.id}`);
    await request("GET", `/api/proxy-pools/${proxyPool.id}`, undefined, 404);
  });

  it("rehydrates persisted edits in a fresh store and reset preserves unrelated storage", async () => {
    const row = store.list("providers.connections")[0];
    await request("PATCH", `/api/providers/${row.id}`, { name: "Survives reload" });
    globalThis.localStorage.setItem("unrelated-setting", "keep");
    vi.resetModules();
    const fresh = await import("../../website/src/mock/store.js");
    expect(fresh.store.find("providers.connections", row.id).name).toBe("Survives reload");
    fresh.resetDemoData();
    expect(globalThis.localStorage.getItem("durindoor-demo:providers.connections")).toBeNull();
    expect(globalThis.localStorage.getItem("unrelated-setting")).toBe("keep");
  });
});

describe("website network boundary", () => {
  it("passes local assets through but keeps known and unsupported APIs entirely offline", async () => {
    const realFetch = vi.fn(async () => new Response("asset"));
    vi.stubGlobal("window", {});
    vi.stubGlobal("location", new URL("https://demo.local"));
    vi.stubGlobal("fetch", realFetch);
    const network = installMockNetwork();
    expect(installMockNetwork()).toBe(network);
    const asset = await globalThis.fetch("/_next/static/app.js");
    expect(await asset.text()).toBe("asset");
    realFetch.mockClear();
    const auth = await settle(globalThis.fetch("/api/auth/status"));
    expect((await auth.json()).requireLogin).toBe(true);
    const local = await settle(globalThis.fetch("/api/not-implemented", { method: "POST" }));
    expect(local.status).toBe(501);
    expect((await local.json()).error).toBeTruthy();
    const remote = await settle(globalThis.fetch("https://provider.example/v1/chat/completions", { method: "POST" }));
    expect(remote.status).toBe(501);
    const tunnel = await settle(globalThis.fetch("https://balin-erebor.trycloudflare.com/api/health"));
    expect(await tunnel.json()).toEqual({ status: "ok" });
    const namespace = await settle(globalThis.fetch("/v1"));
    expect(namespace.status).toBe(501);
    expect(realFetch).not.toHaveBeenCalled();
  });

  it("reports handler exceptions as failures rather than successful writes", async () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("location", new URL("https://demo.local"));
    vi.stubGlobal("fetch", vi.fn());
    vi.spyOn(console, "error").mockImplementation(() => {});
    const network = installMockNetwork();
    network.router.post("/api/explode", () => { throw new Error("handler defect"); });
    const response = await settle(globalThis.fetch("/api/explode", { method: "POST" }));
    expect(response.status).toBe(500);
    expect((await response.json()).error).toBeTruthy();
    expect(toResponse(undefined).status).toBe(500);
  });

  it("keeps melon fixed and rejects incorrect passwords without changing the session", async () => {
    await request("POST", "/api/auth/login", { password: "wrong" }, 401);
    expect((await request("GET", "/api/auth/status")).authenticated).toBe(false);
    await request("POST", "/api/auth/login", { password: "melon" });
    expect((await request("GET", "/api/auth/status")).authenticated).toBe(true);
    await request("POST", "/api/auth/logout");
    expect((await request("GET", "/api/auth/status")).authenticated).toBe(false);
  });
});

describe("website smoke failure behavior", () => {
  it("executes the default behavioral scenarios and detects a broken mutation", async () => {
    expect(await settle(runSmoke({ router, log: () => {} }))).toEqual({ checked: 5, missing: 0, failed: 0, exitCode: 0 });
    const found = router.match("PATCH", "/api/keys/example");
    found.route.handler = () => ({ key: {} });
    expect(await settle(runSmoke({ router, log: () => {} }))).toMatchObject({ failed: 1, exitCode: 1 });
  });

  it("fails missing paths, thrown handlers, missing responses and empty input", async () => {
    const broken = createRouter();
    broken.get("/api/throws", () => { throw new Error("broken handler"); });
    broken.post("/api/empty", () => undefined);
    expect(await runSmoke({ router: broken, paths: ["/api/missing", "/api/throws", "POST /api/empty"], log: () => {} })).toEqual({ checked: 3, missing: 1, failed: 2, exitCode: 1 });
    expect(await runSmoke({ router: broken, paths: [], log: () => {} })).toMatchObject({ checked: 0, failed: 1, exitCode: 1 });
  });

  it("returns a nonzero process exit for a missing route without importing the UA poller", () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), "website-mock-smoke-"));
    const paths = join(temporaryDirectory, "paths.txt");
    writeFileSync(paths, "/api/definitely-unimplemented\n");
    const result = spawnSync(process.execPath, ["--import", "./scripts/register-alias.mjs", "scripts/mock-smoke.mjs", paths], { cwd: siteRoot, encoding: "utf8", timeout: 10_000 });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("missing=1");
    expect(result.stderr).not.toContain("KimchiUA");
  });
});
