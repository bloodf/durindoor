// A setup launch that fails after its browser context exists keeps owning that
// context (session entry and profile lock) until the browser is confirmed
// closed (#2034). Closed mocks: the synthetic fake launcher stands in for
// Playwright, the DB is an in-memory map, and network access is forbidden.
// No real browser, account or provider is used.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  dir: "", launcher: null, operator: true,
  connection: vi.fn(), created: vi.fn(), updated: vi.fn(), removed: vi.fn(),
}));

vi.mock("@/dashboardGuard", () => ({
  isOperatorRequest: vi.fn(async () => m.operator),
  canManageAccessConfig: vi.fn(async () => true),
}));
vi.mock("@/lib/localDb", () => ({
  getSettings: vi.fn(async () => ({})),
  getProviderNodes: vi.fn(async () => []),
  getProviderNodeById: vi.fn(async () => null),
  getProviderConnections: vi.fn(async () => []),
  getProviderConnectionById: m.connection,
  getApiKeyProviderConnectionIds: vi.fn(async () => []),
  getProxyPoolById: vi.fn(async () => null),
  createProviderConnection: m.created,
  updateProviderConnection: m.updated,
  deleteProviderConnection: m.removed,
}));
vi.mock("@/shared/services/quotaAutoPing", () => ({ notifyQuotaAutoPingSettingChanged: vi.fn() }));
vi.mock("@/lib/dataDir.js", () => ({ get DATA_DIR() { return m.dir; } }));
vi.mock("../../open-sse/services/fireflyWebUi/browser.js", async (original) => ({
  ...await original(), playwrightLauncher: { launchPersistentContext: (...args) => m.launcher.launchPersistentContext(...args) },
}));

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fakeLauncher } from "../fixtures/fireflyWebUi/fakeBrowser.js";
import { mergeProviderSpecificData } from "../../src/lib/db/helpers/mergeProviderMetadata.js";
import { profileBusy } from "../../open-sse/services/fireflyWebUi/profile.js";
import { closeFireflyWebUiSetup, fireflySetupStatus, openFireflyWebUiSetupIds } from "../../open-sse/services/fireflyWebUi/setup.js";
const { POST: createConnection } = await import("@/app/api/providers/route.js");
const { DELETE: deleteConnection } = await import("@/app/api/providers/[id]/route.js");
const { POST: start, DELETE: closeSetup } = await import("@/app/api/providers/[id]/firefly-setup/route.js");

const rows = new Map();
let counter = 0;
const request = (body = {}, method = "POST") => new Request("http://localhost/api/providers", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const context = (id) => ({ params: Promise.resolve({ id }) });
const tick = () => new Promise((resolve) => setImmediate(resolve));
const remove = (id) => deleteConnection(new Request(`http://localhost/api/providers/${id}`, { method: "DELETE" }), context(id));
const failingClose = (browser) => { browser.close = async () => { browser.closeCalls++; throw new Error("synthetic close failure"); }; };
// The operator closing the window: the context emits its own close event.
const windowClosed = (browser) => { browser.closed = true; for (const listener of browser.listeners.close || []) listener(); };
async function createEnabled() {
  const response = await createConnection(request({ provider: "adobe-firefly-web", name: `Synthetic cleanup ${counter + 1}`, providerSpecificData: { fireflyWebUi: { enabled: false } } }));
  const { connection } = await response.json();
  const row = rows.get(connection.id);
  rows.set(connection.id, { ...row, providerSpecificData: { fireflyWebUi: { ...row.providerSpecificData.fireflyWebUi, enabled: true } } });
  return connection.id;
}
/** Start a setup whose navigation waits on a gate the test rejects. */
async function gatedStart(id) {
  let fail;
  const gate = new Promise((_, rejectGate) => { fail = rejectGate; });
  m.launcher = fakeLauncher((page) => { page.onGoto = () => gate; });
  const starting = start(request(), context(id));
  await tick();
  return { starting, browser: m.launcher.launches[0].context, fail: () => fail(new Error("synthetic navigation failure")) };
}

beforeEach(() => {
  vi.clearAllMocks(); rows.clear(); m.operator = true;
  m.dir = fs.mkdtempSync(path.join(os.tmpdir(), "firefly-launch-cleanup-"));
  m.launcher = fakeLauncher();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network forbidden"); }));
  m.created.mockImplementation(async (data) => { const row = { ...data, id: `cleanup-${++counter}` }; rows.set(row.id, row); return row; });
  m.updated.mockImplementation(async (id, patch) => { const row = rows.get(id); const next = { ...row, ...patch, providerSpecificData: mergeProviderSpecificData(row.providerSpecificData, patch.providerSpecificData) }; rows.set(id, next); return next; });
  m.connection.mockImplementation(async (id) => rows.get(id));
  m.removed.mockImplementation(async (id) => rows.delete(id));
});
afterEach(async () => {
  vi.useRealTimers();
  for (const launch of m.launcher.launches) {
    launch.context.hangClose = false;
    delete launch.context.close;
    if (!launch.context.closed) windowClosed(launch.context);
  }
  for (const id of openFireflyWebUiSetupIds()) closeFireflyWebUiSetup(id);
  await tick();
  vi.unstubAllGlobals();
  fs.rmSync(m.dir, { recursive: true, force: true });
});

describe("Firefly setup keeps ownership of a browser whose start failed (closed mocks)", () => {
  it("navigation failure plus close failure during a concurrent delete keeps row, session and lock", async () => {
    const id = await createEnabled();
    const { starting, browser, fail } = await gatedStart(id);
    failingClose(browser);
    const deleting = remove(id);
    await tick();
    fail();
    const started = await starting;
    const deleted = await deleting;
    expect(started.status).toBe(502);
    expect(deleted.status).toBe(502);
    expect(await deleted.json()).toMatchObject({ outcome: "close_failed" });
    expect(m.removed).not.toHaveBeenCalled();
    expect(rows.has(id)).toBe(true);
    expect(browser.closed).toBe(false);
    expect(fireflySetupStatus(id).open).toBe(true);
    expect(profileBusy(browser.dir)).toBe(true);
    // The busy profile refuses a duplicate launch.
    expect((await start(request(), context(id))).status).toBe(409);
    expect(m.launcher.launches).toHaveLength(1);

    // A later delete retries the close, succeeds and releases once.
    delete browser.close;
    const before = browser.closeCalls;
    expect((await remove(id)).status).toBe(200);
    expect(browser.closeCalls).toBe(before + 1);
    expect(browser.closed).toBe(true);
    expect(rows.has(id)).toBe(false);
    expect(fireflySetupStatus(id).open).toBe(false);
    expect(profileBusy(browser.dir)).toBe(false);
    expect(openFireflyWebUiSetupIds()).toEqual([]);
  });

  it("a close that hangs during a failed start is bounded and keeps ownership until the window closes", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const id = await createEnabled();
    const { starting, browser, fail } = await gatedStart(id);
    browser.hangClose = true;
    fail();
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await starting).status).toBe(502);
    expect(fireflySetupStatus(id).open).toBe(true);
    expect(profileBusy(browser.dir)).toBe(true);

    const deleting = remove(id);
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await deleting).status).toBe(502);
    expect(rows.has(id)).toBe(true);
    expect(profileBusy(browser.dir)).toBe(true);

    // The close event is proof the browser closed.
    windowClosed(browser);
    expect(fireflySetupStatus(id).open).toBe(false);
    expect(profileBusy(browser.dir)).toBe(false);
    expect((await remove(id)).status).toBe(200);
    expect(rows.has(id)).toBe(false);
  });

  it("an explicit setup close retries a failed-start close and releases the lock once", async () => {
    const id = await createEnabled();
    const { starting, browser, fail } = await gatedStart(id);
    failingClose(browser);
    fail();
    expect((await starting).status).toBe(502);
    expect(fireflySetupStatus(id).open).toBe(true);
    expect(profileBusy(browser.dir)).toBe(true);

    delete browser.close;
    const closed = await (await closeSetup(request({}, "DELETE"), context(id))).json();
    expect(closed.closed).toBe(true);
    await tick();
    expect(browser.closed).toBe(true);
    expect(fireflySetupStatus(id).open).toBe(false);
    expect(profileBusy(browser.dir)).toBe(false);
    // The profile is free again: a new setup can open and its row is intact.
    m.launcher = fakeLauncher();
    expect((await start(request(), context(id))).status).toBe(200);
    expect(profileBusy(m.launcher.launches[0].dir)).toBe(true);
  });

  it("a close that throws after the close event fired counts as closed", async () => {
    const id = await createEnabled();
    const { starting, browser, fail } = await gatedStart(id);
    browser.close = async () => { browser.closeCalls++; windowClosed(browser); throw new Error("synthetic close error after close"); };
    fail();
    expect((await starting).status).toBe(502);
    expect(browser.closeCalls).toBe(1);
    expect(fireflySetupStatus(id).open).toBe(false);
    expect(profileBusy(browser.dir)).toBe(false);
  });

  it("page creation failure after the context exists keeps ownership when its close fails", async () => {
    const id = await createEnabled();
    m.launcher = fakeLauncher((page) => {
      page.context.pages = () => [];
      page.context.newPage = async () => { throw new Error("synthetic page failure"); };
      failingClose(page.context);
    });
    expect((await start(request(), context(id))).status).toBe(502);
    const browser = m.launcher.launches[0].context;
    expect(fireflySetupStatus(id).open).toBe(true);
    expect(profileBusy(browser.dir)).toBe(true);
    expect((await remove(id)).status).toBe(502);
    expect(rows.has(id)).toBe(true);
    delete browser.close;
    expect((await remove(id)).status).toBe(200);
    expect(browser.closed).toBe(true);
    expect(profileBusy(browser.dir)).toBe(false);
  });

  it("a failed start on one connection leaves another connection untouched", async () => {
    const first = await createEnabled();
    const second = await createEnabled();
    const { starting, browser, fail } = await gatedStart(first);
    failingClose(browser);
    fail();
    expect((await starting).status).toBe(502);
    m.launcher = fakeLauncher();
    expect((await start(request(), context(second))).status).toBe(200);
    const other = m.launcher.launches[0].context;
    expect((await remove(first)).status).toBe(502);
    expect(other.closeCalls).toBe(0);
    expect(fireflySetupStatus(second).open).toBe(true);
    expect(profileBusy(other.dir)).toBe(true);
    expect(rows.has(second)).toBe(true);
    // Restore the first browser so cleanup can close it.
    m.launcher.launches.push({ dir: browser.dir, context: browser });
  });

  it("a normal startup failure whose close succeeds releases everything and delete proceeds", async () => {
    const id = await createEnabled();
    const { starting, browser, fail } = await gatedStart(id);
    const deleting = remove(id);
    await tick();
    fail();
    expect((await starting).status).toBe(502);
    expect((await deleting).status).toBe(200);
    expect(browser.closeCalls).toBe(1);
    expect(browser.closed).toBe(true);
    expect(rows.has(id)).toBe(false);
    expect(fireflySetupStatus(id).open).toBe(false);
    expect(profileBusy(browser.dir)).toBe(false);
    expect(openFireflyWebUiSetupIds()).toEqual([]);
  });
});
