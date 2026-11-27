// #2034 staged Firefly web UI: account isolation, profile locks and the
// operator setup session, against a SYNTHETIC fake launcher. No real browser
// is launched and nothing is contacted.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAdobeFireflyWebImageAdapter } from "../../open-sse/handlers/imageProviders/adobe-firefly-web.js";
import { SETUP_LAUNCH_OPTIONS } from "../../open-sse/services/fireflyWebUi/browser.js";
import { createFireflyWebUiJournal } from "../../open-sse/services/fireflyWebUi/journal.js";
import { acquireProfile, profileBusy, profileDir } from "../../open-sse/services/fireflyWebUi/profile.js";
import {
  closeFireflyWebUiSetup, initializeFireflyWebUiProfile, openFireflyWebUiSetup, openFireflyWebUiSetupIds,
} from "../../open-sse/services/fireflyWebUi/setup.js";
import { JPEG, PNG, addResult, fakeLauncher, syntheticCredentials, syntheticWorkspace } from "../fixtures/fireflyWebUi/fakeBrowser.js";

const OPERATOR = Object.freeze({ authenticated: true });
let dataDir;
let tmpRoot;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "firefly-web-iso-data-"));
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "firefly-web-iso-tmp-"));
});

afterEach(() => {
  vi.useRealTimers();
  for (const id of openFireflyWebUiSetupIds()) closeFireflyWebUiSetup(id);
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

async function account(connectionId, deps) {
  const { profileHandle } = await initializeFireflyWebUiProfile({ credentials: { connectionId }, operator: OPERATOR, deps });
  return syntheticCredentials({ connectionId, profileHandle });
}

describe("profile initialization", () => {
  it("needs an authenticated operator and refuses secrets or an existing handle", async () => {
    const deps = { dataDir };
    await expect(initializeFireflyWebUiProfile({ credentials: { connectionId: "conn-a" }, deps })).rejects.toMatchObject({ status: 403 });
    await expect(initializeFireflyWebUiProfile({ credentials: { connectionId: "conn-a", apiKey: "synthetic" }, operator: OPERATOR, deps })).rejects.toMatchObject({ status: 400 });
    const credentials = await account("conn-a", deps);
    await expect(initializeFireflyWebUiProfile({ credentials, operator: OPERATOR, deps })).rejects.toMatchObject({ status: 409 });
  });
});

describe("two accounts", () => {
  it("use separate profiles, contexts, pages, outputs and journal entries", async () => {
    const journal = createFireflyWebUiJournal();
    const byConnection = { "conn-a": PNG, "conn-b": JPEG };
    const launcher = fakeLauncher();
    const launch = launcher.launchPersistentContext.bind(launcher);
    launcher.launchPersistentContext = async (dir, options) => {
      const context = await launch(dir, options);
      const owner = Object.keys(byConnection).find((id) => dir.includes(`${path.sep}${id}${path.sep}`));
      syntheticWorkspace(context.initialPage, { bytes: byConnection[owner] });
      return context;
    };
    const deps = { launcher, dataDir, journal, tmpRoot };
    const adapter = createAdobeFireflyWebImageAdapter(deps);
    const a = await account("conn-a", deps);
    const b = await account("conn-b", deps);
    const [ra, rb] = await Promise.all([
      adapter.generate({ model: "synthetic-image", body: { prompt: "a" }, credentials: a }),
      adapter.generate({ model: "synthetic-image", body: { prompt: "b" }, credentials: b }),
    ]);
    expect(ra.success && rb.success).toBe(true);
    expect(JSON.parse(await ra.response.text()).data[0].b64_json).toBe(PNG.toString("base64"));
    expect(JSON.parse(await rb.response.text()).data[0].b64_json).toBe(JPEG.toString("base64"));
    const [la, lb] = launcher.launches;
    expect(la.context).not.toBe(lb.context);
    expect(la.context.initialPage).not.toBe(lb.context.initialPage);
    expect(new Set([la.dir, lb.dir]).size).toBe(2);
    expect(la.dir).toBe(profileDir(dataDir, "conn-a", a.providerSpecificData.fireflyWebUi.profileHandle));
    expect(lb.dir).toBe(profileDir(dataDir, "conn-b", b.providerSpecificData.fireflyWebUi.profileHandle));
    for (const { context } of launcher.launches) {
      expect(context.closeCalls).toBe(1);
      expect(context.forbidden).toEqual([]);
    }
    expect(journal.list().map(({ connectionId }) => connectionId).sort()).toEqual(["conn-a", "conn-b"]);
  });

  it("one account cannot use another account's profile handle", async () => {
    const launcher = fakeLauncher(syntheticWorkspace);
    const deps = { launcher, dataDir, tmpRoot, journal: createFireflyWebUiJournal() };
    await account("conn-a", deps);
    const b = await account("conn-b", deps);
    const stolen = syntheticCredentials({ connectionId: "conn-a", profileHandle: b.providerSpecificData.fireflyWebUi.profileHandle });
    const result = await createAdobeFireflyWebImageAdapter(deps).generate({ model: "synthetic-image", body: { prompt: "p" }, credentials: stolen });
    expect(result).toMatchObject({ success: false, status: 409 });
    expect(launcher.launches).toEqual([]);
  });
});

describe("profile lock", () => {
  it("a busy profile is 409 with no launch, and frees once released", async () => {
    const launcher = fakeLauncher(syntheticWorkspace);
    const deps = { launcher, dataDir, tmpRoot, journal: createFireflyWebUiJournal() };
    const credentials = await account("conn-a", deps);
    const dir = profileDir(dataDir, "conn-a", credentials.providerSpecificData.fireflyWebUi.profileHandle);
    const release = acquireProfile(dir, "generation");
    const adapter = createAdobeFireflyWebImageAdapter(deps);
    const busy = await adapter.generate({ model: "synthetic-image", body: { prompt: "p" }, credentials });
    expect(busy).toMatchObject({ success: false, status: 409, outcome: "busy" });
    expect(launcher.launches).toEqual([]);
    release();
    release();
    expect(profileBusy(dir)).toBe(false);
    expect((await adapter.generate({ model: "synthetic-image", body: { prompt: "p" }, credentials })).success).toBe(true);
    expect(profileBusy(dir)).toBe(false);
  });

  it("a context that never closes keeps its profile busy instead of shared", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const launcher = fakeLauncher((page) => {
      syntheticWorkspace(page);
      page.context.hangClose = true;
    });
    const deps = { launcher, dataDir, tmpRoot, journal: createFireflyWebUiJournal() };
    const credentials = await account("conn-a", deps);
    const pending = createAdobeFireflyWebImageAdapter(deps).generate({ model: "synthetic-image", body: { prompt: "p" }, credentials });
    await vi.advanceTimersByTimeAsync(15_000);
    expect((await pending).success).toBe(true);
    expect(profileBusy(profileDir(dataDir, "conn-a", credentials.providerSpecificData.fireflyWebUi.profileHandle))).toBe(true);
  });
});

describe("operator setup session", () => {
  it("opens a headed ordinary browser on the Firefly origin without a mapping and does nothing else", async () => {
    const launcher = fakeLauncher();
    const deps = { launcher, dataDir };
    const initialized = await account("conn-a", deps);
    const handle = initialized.providerSpecificData.fireflyWebUi.profileHandle;
    // Guard and profile only: no mapping or model map yet.
    const credentials = { connectionId: "conn-a", providerSpecificData: { fireflyWebUi: { enabled: true, profileHandle: handle } } };
    const session = await openFireflyWebUiSetup({ credentials, operator: OPERATOR, deps });
    expect(Object.keys(session).sort()).toEqual(["origin", "setupId"]);
    expect(session.origin).toBe("https://firefly.adobe.com");
    expect(JSON.stringify(session)).not.toContain(handle);
    const [{ options, context, dir }] = launcher.launches;
    expect(options).toEqual(SETUP_LAUNCH_OPTIONS);
    expect(options).toEqual({ headless: false });
    expect(dir).toBe(profileDir(dataDir, "conn-a", handle));
    expect(context.initialPage.calls).toEqual([["goto", "https://firefly.adobe.com/", { waitUntil: "domcontentloaded", timeout: 30_000 }]]);
    expect(context.forbidden).toEqual([]);

    // Generation is refused while the human setup context is open, and does not touch it.
    const generation = await createAdobeFireflyWebImageAdapter({ launcher, dataDir, tmpRoot, journal: createFireflyWebUiJournal() })
      .generate({ model: "synthetic-image", body: { prompt: "p" }, credentials: syntheticCredentials({ connectionId: "conn-a", profileHandle: handle }) });
    expect(generation).toMatchObject({ status: 409, outcome: "busy" });
    expect(launcher.launches).toHaveLength(1);
    expect(context.closeCalls).toBe(0);
    // A second setup on the same profile is refused too.
    await expect(openFireflyWebUiSetup({ credentials, operator: OPERATOR, deps })).rejects.toMatchObject({ status: 409 });

    expect(closeFireflyWebUiSetup(session.setupId)).toBe(true);
    expect(closeFireflyWebUiSetup(session.setupId)).toBe(false);
    await vi.waitFor(() => expect(context.closeCalls).toBe(1));
    await vi.waitFor(() => expect(profileBusy(dir)).toBe(false));
  });

  it("releases the profile when the operator closes the window", async () => {
    const launcher = fakeLauncher();
    const deps = { launcher, dataDir };
    const credentials = await account("conn-a", deps);
    await openFireflyWebUiSetup({ credentials, operator: OPERATOR, deps });
    const [{ context, dir }] = launcher.launches;
    await context.close();
    await vi.waitFor(() => expect(profileBusy(dir)).toBe(false));
    expect(openFireflyWebUiSetupIds()).toEqual([]);
  });

  it("needs an authenticated operator, the enabled guard and an initialized profile before any launch", async () => {
    const launcher = fakeLauncher();
    const deps = { launcher, dataDir };
    const credentials = await account("conn-a", deps);
    const handle = credentials.providerSpecificData.fireflyWebUi.profileHandle;
    await expect(openFireflyWebUiSetup({ credentials, deps })).rejects.toMatchObject({ status: 403 });
    await expect(openFireflyWebUiSetup({ credentials, operator: { authenticated: "yes" }, deps })).rejects.toMatchObject({ status: 403 });
    const disabled = { connectionId: "conn-a", providerSpecificData: { fireflyWebUi: { enabled: false, profileHandle: handle } } };
    await expect(openFireflyWebUiSetup({ credentials: disabled, operator: OPERATOR, deps })).rejects.toMatchObject({ status: 403 });
    const uninitialized = { connectionId: "conn-z", providerSpecificData: { fireflyWebUi: { enabled: true, profileHandle: handle } } };
    await expect(openFireflyWebUiSetup({ credentials: uninitialized, operator: OPERATOR, deps })).rejects.toMatchObject({ status: 409 });
    const withCookie = { ...credentials, cookie: "synthetic=1" };
    await expect(openFireflyWebUiSetup({ credentials: withCookie, operator: OPERATOR, deps })).rejects.toMatchObject({ status: 400 });
    expect(launcher.launches).toEqual([]);
  });

  it("a failed setup navigation closes its context once and frees the profile", async () => {
    const launcher = fakeLauncher((page) => { page.onGoto = () => { throw new Error("synthetic failure at /private/path"); }; });
    const deps = { launcher, dataDir };
    const credentials = await account("conn-a", deps);
    const error = await openFireflyWebUiSetup({ credentials, operator: OPERATOR, deps }).catch((caught) => caught);
    expect(error).toMatchObject({ status: 502 });
    expect(error.message).not.toContain("/private/path");
    const [{ context, dir }] = launcher.launches;
    expect(context.closeCalls).toBe(1);
    expect(profileBusy(dir)).toBe(false);
  });
});

describe("result ownership", () => {
  it("never returns another item's artifact: only the new item's download is clicked", async () => {
    const launcher = fakeLauncher((page) => {
      addResult(page, { id: "earlier", bytes: JPEG });
      syntheticWorkspace(page, { bytes: PNG });
    });
    const deps = { launcher, dataDir, tmpRoot, journal: createFireflyWebUiJournal() };
    const credentials = await account("conn-a", deps);
    const result = await createAdobeFireflyWebImageAdapter(deps).generate({ model: "synthetic-image", body: { prompt: "p" }, credentials });
    expect(result.success).toBe(true);
    expect(JSON.parse(await result.response.text()).data[0].b64_json).toBe(PNG.toString("base64"));
  });
});
