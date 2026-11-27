// Deleting a Firefly browser connection closes and awaits only that
// connection's own setup browser first (#2034). Closed mocks: a synthetic fake
// launcher stands in for Playwright, the DB is an in-memory map, and network
// access is forbidden. No real browser, account or provider is used.
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
import {
  closeFireflyWebUiSetup, fireflySetupStatus, openFireflyWebUiSetup, openFireflyWebUiSetupIds, retireFireflyWebUiSetup,
} from "../../open-sse/services/fireflyWebUi/setup.js";
const { POST: createConnection } = await import("@/app/api/providers/route.js");
const { DELETE: deleteConnection } = await import("@/app/api/providers/[id]/route.js");
const { GET: status, POST: start } = await import("@/app/api/providers/[id]/firefly-setup/route.js");

const rows = new Map();
// Ids never repeat across tests: a deleted connection id stays retired.
let counter = 0;
const request = (body = {}, method = "POST") => new Request("http://localhost/api/providers", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const context = (id) => ({ params: Promise.resolve({ id }) });
const tick = () => new Promise((resolve) => setImmediate(resolve));
const remove = (id) => deleteConnection(new Request(`http://localhost/api/providers/${id}`, { method: "DELETE" }), context(id));
async function createEnabled() {
  const response = await createConnection(request({ provider: "adobe-firefly-web", name: `Synthetic ${counter + 1}`, providerSpecificData: { fireflyWebUi: { enabled: false } } }));
  const { connection } = await response.json();
  const row = rows.get(connection.id);
  rows.set(connection.id, { ...row, providerSpecificData: { fireflyWebUi: { ...row.providerSpecificData.fireflyWebUi, enabled: true } } });
  return connection.id;
}
async function openSetup(id) {
  const response = await start(request(), context(id));
  expect(response.status).toBe(200);
  return m.launcher.launches.at(-1).context;
}
const dirOf = (browser) => browser.dir;

beforeEach(() => {
  vi.clearAllMocks(); rows.clear(); m.operator = true;
  m.dir = fs.mkdtempSync(path.join(os.tmpdir(), "firefly-delete-"));
  m.launcher = fakeLauncher();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network forbidden"); }));
  m.created.mockImplementation(async (data) => { const row = { ...data, id: `conn-${++counter}` }; rows.set(row.id, row); return row; });
  m.updated.mockImplementation(async (id, patch) => { const row = rows.get(id); const next = { ...row, ...patch, providerSpecificData: mergeProviderSpecificData(row.providerSpecificData, patch.providerSpecificData) }; rows.set(id, next); return next; });
  m.connection.mockImplementation(async (id) => rows.get(id));
  m.removed.mockImplementation(async (id) => rows.delete(id));
});
afterEach(async () => {
  for (const launch of m.launcher.launches) { launch.context.hangClose = false; delete launch.context.close; }
  for (const id of openFireflyWebUiSetupIds()) closeFireflyWebUiSetup(id);
  await tick();
  vi.unstubAllGlobals();
  fs.rmSync(m.dir, { recursive: true, force: true });
});

describe("Firefly connection delete closes its owned setup browser (closed mocks)", () => {
  it("open -> delete -> closed: the browser and profile lock are released before the row goes", async () => {
    const id = await createEnabled();
    const before = openFireflyWebUiSetupIds();
    const browser = await openSetup(id);
    expect(fireflySetupStatus(id).open).toBe(true);
    m.removed.mockImplementation(async (rowId) => {
      // The row disappears only after the owned browser is already closed.
      expect(browser.closed).toBe(true);
      expect(fireflySetupStatus(rowId).open).toBe(false);
      return rows.delete(rowId);
    });
    const response = await remove(id);
    expect(response.status).toBe(200);
    expect(m.removed).toHaveBeenCalledWith(id);
    expect(browser.closeCalls).toBe(1);
    expect(fireflySetupStatus(id)).toEqual({ open: false, outcome: "unknown", liveVerified: false });
    expect(profileBusy(dirOf(browser))).toBe(false);
    expect(openFireflyWebUiSetupIds()).toEqual(before);
    expect(browser.forbidden).toEqual([]);
    // The id is gone and stays retired: no new setup can be opened for it.
    expect((await start(request(), context(id))).status).toBe(404);
    await expect(openFireflyWebUiSetup({ credentials: { ...rows.get(id), connectionId: id }, operator: { authenticated: true } })).rejects.toBeTruthy();
    expect(m.launcher.launches).toHaveLength(1);
  });

  it("deleting with no setup open still works", async () => {
    const id = await createEnabled();
    expect((await remove(id)).status).toBe(200);
    expect(rows.has(id)).toBe(false);
    expect(m.launcher.launches).toHaveLength(0);
  });

  it("gateway or unauthenticated callers are denied and nothing is closed or deleted", async () => {
    const id = await createEnabled();
    const browser = await openSetup(id);
    m.operator = false;
    const response = await remove(id);
    expect(response.status).toBe(403);
    expect(m.removed).not.toHaveBeenCalled();
    expect(rows.has(id)).toBe(true);
    expect(browser.closeCalls).toBe(0);
    expect(fireflySetupStatus(id).open).toBe(true);
  });

  it("leaves another connection's setup session and profile untouched", async () => {
    const first = await createEnabled();
    const second = await createEnabled();
    const firstBrowser = await openSetup(first);
    const secondBrowser = await openSetup(second);
    expect((await remove(first)).status).toBe(200);
    expect(firstBrowser.closed).toBe(true);
    expect(secondBrowser.closed).toBe(false);
    expect(secondBrowser.closeCalls).toBe(0);
    expect(fireflySetupStatus(second).open).toBe(true);
    expect(profileBusy(dirOf(secondBrowser))).toBe(true);
    expect(rows.has(second)).toBe(true);
  });

  it("a failed close is reported truthfully, keeps the row and the session, and can be retried", async () => {
    const id = await createEnabled();
    const browser = await openSetup(id);
    browser.close = async () => { browser.closeCalls++; throw new Error("synthetic close failure"); };
    const response = await remove(id);
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body).toMatchObject({ outcome: "close_failed" });
    expect(body.error).toContain("not deleted");
    expect(JSON.stringify(body)).not.toContain(m.dir);
    expect(m.removed).not.toHaveBeenCalled();
    expect(rows.has(id)).toBe(true);
    expect(fireflySetupStatus(id).open).toBe(true);
    expect(profileBusy(dirOf(browser))).toBe(true);
    // Status through the route agrees; the connection is not retired.
    expect((await (await status(request(), context(id))).json()).open).toBe(true);

    delete browser.close;
    expect((await remove(id)).status).toBe(200);
    expect(browser.closed).toBe(true);
    expect(fireflySetupStatus(id).open).toBe(false);
    expect(profileBusy(dirOf(browser))).toBe(false);
    expect(rows.has(id)).toBe(false);
  });

  it("a close that never finishes times out as a failure instead of claiming success", async () => {
    const id = await createEnabled();
    const browser = await openSetup(id);
    browser.hangClose = true;
    await expect(retireFireflyWebUiSetup(id, { closeTimeoutMs: 5 })).rejects.toMatchObject({ status: 502, outcome: "close_failed" });
    expect(fireflySetupStatus(id).open).toBe(true);
    expect(profileBusy(dirOf(browser))).toBe(true);
    // The block was lifted: the row can still be managed and deleted later.
    expect(m.removed).not.toHaveBeenCalled();
  });

  it("a launch in flight during delete is awaited and then closed, leaving no orphan", async () => {
    const id = await createEnabled();
    const before = openFireflyWebUiSetupIds();
    let resume;
    const gate = new Promise((resolve) => { resume = resolve; });
    const inner = m.launcher.launchPersistentContext.bind(m.launcher);
    m.launcher.launchPersistentContext = async (...args) => { await gate; return inner(...args); };
    const starting = start(request(), context(id));
    await tick();
    let deleteDone = false;
    const deleting = remove(id).then((response) => { deleteDone = true; return response; });
    await tick();
    expect(deleteDone).toBe(false);
    expect(m.removed).not.toHaveBeenCalled();
    // A second launch while the delete is pending is refused before any browser starts.
    expect((await start(request(), context(id))).status).toBe(409);
    resume();
    expect((await starting).status).toBe(200);
    expect((await deleting).status).toBe(200);
    expect(m.launcher.launches).toHaveLength(1);
    expect(m.launcher.launches[0].context.closed).toBe(true);
    expect(fireflySetupStatus(id).open).toBe(false);
    expect(openFireflyWebUiSetupIds()).toEqual(before);
    expect(profileBusy(dirOf(m.launcher.launches[0].context))).toBe(false);
  });

  it("a launch that fails during delete releases everything and the delete succeeds", async () => {
    const id = await createEnabled();
    const before = openFireflyWebUiSetupIds();
    let fail;
    const gate = new Promise((_, rejectGate) => { fail = rejectGate; });
    m.launcher.launchPersistentContext = async () => gate;
    const starting = start(request(), context(id));
    await tick();
    const deleting = remove(id);
    fail(new Error("synthetic launch failure"));
    expect((await starting).status).toBe(502);
    expect((await deleting).status).toBe(200);
    expect(fireflySetupStatus(id).open).toBe(false);
    expect(openFireflyWebUiSetupIds()).toEqual(before);
  });

  it("a start that read the row before a delete committed cannot open a browser afterwards", async () => {
    const id = await createEnabled();
    const credentials = { ...rows.get(id), connectionId: id };
    expect((await remove(id)).status).toBe(200);
    await expect(openFireflyWebUiSetup({ credentials, operator: { authenticated: true }, deps: { dataDir: m.dir } })).rejects.toMatchObject({ status: 409 });
    expect(m.launcher.launches).toHaveLength(0);
  });

  it("concurrent deletes close once and only one removes the row", async () => {
    const id = await createEnabled();
    const browser = await openSetup(id);
    const [a, b] = await Promise.all([remove(id), remove(id)]);
    expect([a.status, b.status].sort()).toEqual([200, 404]);
    expect(browser.closeCalls).toBe(1);
    expect(fireflySetupStatus(id).open).toBe(false);
  });

  it("when the row delete fails the connection is not retired and setup can reopen", async () => {
    const id = await createEnabled();
    await openSetup(id);
    m.removed.mockImplementationOnce(async () => { throw new Error("synthetic db failure"); });
    expect((await remove(id)).status).toBe(500);
    expect(rows.has(id)).toBe(true);
    expect(fireflySetupStatus(id).open).toBe(false);
    await openSetup(id);
    expect(fireflySetupStatus(id).open).toBe(true);
  });
});
