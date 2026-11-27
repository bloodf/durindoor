// #2034 staged Firefly web UI: the guarded generation flow against a
// SYNTHETIC fake browser (tests/fixtures/fireflyWebUi/fakeBrowser.js). No real
// browser is launched and no Adobe or other host is contacted. Passing here
// shows our state machine only, not Adobe compatibility.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAdobeFireflyWebImageAdapter } from "../../open-sse/handlers/imageProviders/adobe-firefly-web.js";
import { createAdobeFireflyWebVideoAdapter } from "../../open-sse/handlers/videoProviders/adobe-firefly-web.js";
import { GENERATION_LAUNCH_OPTIONS } from "../../open-sse/services/fireflyWebUi/browser.js";
import { createFireflyWebUiJournal } from "../../open-sse/services/fireflyWebUi/journal.js";
import { initializeProfile } from "../../open-sse/services/fireflyWebUi/profile.js";
import {
  FakeDownload, HTML, MP4, PNG, WEBM, addResult, fakeLauncher, syntheticCredentials, syntheticMapping, syntheticWorkspace,
} from "../fixtures/fireflyWebUi/fakeBrowser.js";

let dataDir;
let tmpRoot;
let journal;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "firefly-web-flow-data-"));
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "firefly-web-flow-tmp-"));
  journal = createFireflyWebUiJournal();
});

afterEach(() => {
  vi.useRealTimers();
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function setup({ connectionId = "conn-a", workspace = {}, page: pageSetup, credentials: overrides = {} } = {}) {
  const { profileHandle } = initializeProfile({ dataDir, connectionId });
  const launcher = fakeLauncher((page) => {
    syntheticWorkspace(page, workspace);
    pageSetup?.(page);
  });
  const deps = { launcher, dataDir, journal, tmpRoot };
  const credentials = syntheticCredentials({ connectionId, profileHandle, ...overrides });
  return {
    launcher,
    credentials,
    profileHandle,
    image: createAdobeFireflyWebImageAdapter(deps),
    video: createAdobeFireflyWebVideoAdapter(deps),
    page: () => launcher.launches[0]?.context.initialPage,
  };
}

const submits = (page) => page.calls.filter(([kind, name]) => kind === "click" && name === "Synthetic generate").length;
const json = async (result) => JSON.parse(await result.response.text());
const leftovers = () => fs.readdirSync(tmpRoot);

describe("successful synthetic generation", () => {
  it("returns a verified image as local b64_json and counts one image once", async () => {
    const run = setup();
    const result = await run.image.generate({ model: "synthetic-image", body: { prompt: "a synthetic fox" }, credentials: run.credentials });
    expect(result.success).toBe(true);
    const payload = await json(result);
    expect(payload.data).toEqual([{ b64_json: PNG.toString("base64"), mime_type: "image/png", output_format: "png" }]);
    expect(result.accounting).toMatchObject({ state: "complete", modality: "image", nativeUnits: { images: 1 }, cost: null, costStatus: "unknown", tokens: {} });
    expect(result.acceptedJob).toBeUndefined();
    const page = run.page();
    expect(submits(page)).toBe(1);
    expect(page.calls.find(([kind]) => kind === "fill")).toEqual(["fill", "Synthetic prompt"]);
    // The requested model was explicitly selected by its mapped UI label.
    expect(page.calls).toContainEqual(["getByRole", "option", { name: "Synthetic Image Label", exact: true }]);
    expect(page.calls.filter(([kind]) => kind === "goto")).toEqual([["goto", "https://firefly.adobe.com/", { waitUntil: "domcontentloaded", timeout: 30_000 }]]);
    expect(journal.list()).toEqual([expect.objectContaining({ state: "completed", model: "synthetic-image", kind: "image", connectionId: "conn-a" })]);
    // No path, URL or profile detail is returned.
    const text = JSON.stringify(payload);
    expect(text).not.toContain(dataDir);
    expect(text).not.toContain(tmpRoot);
    expect(text).not.toContain("synthetic.invalid");
    expect(text).not.toContain(run.profileHandle);
    expect(leftovers()).toEqual([]);
  });

  it("returns a verified video (mp4 and webm) with videos counted, no invented duration or cost", async () => {
    for (const [bytes, mime, format] of [[MP4, "video/mp4", "mp4"], [WEBM, "video/webm", "webm"]]) {
      const run = setup({ connectionId: `conn-${format}`, workspace: { bytes } });
      const result = await run.video.generate({ model: "synthetic-video", body: { prompt: "a synthetic river", response_format: "b64_json" }, credentials: run.credentials });
      expect(result.success).toBe(true);
      expect((await json(result)).data).toEqual([{ b64_json: bytes.toString("base64"), mime_type: mime, output_format: format }]);
      expect(result.accounting.nativeUnits).toEqual({ videos: 1 });
      expect(result.accounting.nativeUnits.videoSeconds).toBeUndefined();
      expect(result.accounting.cost).toBeNull();
      expect(run.page().calls).toContainEqual(["getByRole", "option", { name: "Synthetic Video Label", exact: true }]);
    }
  });

  it("launches ordinary Chromium options only, uses no forbidden surface and closes owned resources once", async () => {
    const run = setup();
    await run.image.generate({ model: "synthetic-image", body: { prompt: "p" }, credentials: run.credentials });
    const [{ dir, options, context }] = run.launcher.launches;
    expect(options).toEqual(GENERATION_LAUNCH_OPTIONS);
    expect(options).toEqual({ headless: true, acceptDownloads: true });
    expect(dir).toBe(path.join(dataDir, "browser-profiles", "adobe-firefly-web", "conn-a", run.profileHandle));
    expect(context.forbidden).toEqual([]);
    expect(context.closeCalls).toBe(1);
    const page = run.page();
    expect(page.calls.some(([kind]) => ["evaluate", "addInitScript", "setExtraHTTPHeaders", "route", "keyboard", "click-options"].includes(kind))).toBe(false);
  });

  it("downloads through the UI event only, never by fetching a URL", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const run = setup();
    await run.image.generate({ model: "synthetic-image", body: { prompt: "p" }, credentials: run.credentials });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(run.page().calls.filter(([kind]) => kind === "waitForEvent")).toEqual([["waitForEvent", "download", { timeout: 120_000 }]]);
    fetchSpy.mockRestore();
  });
});

describe("refusals before launch", () => {
  it.each([
    ["url output", "image", { prompt: "p", response_format: "url" }],
    ["url output for video", "video", { prompt: "p", response_format: "url" }],
    ["n 2", "image", { prompt: "p", n: 2 }],
    ["unsupported size", "image", { prompt: "p", size: "512x512" }],
    ["unsupported seconds", "video", { prompt: "p", seconds: 8 }],
    ["mapping override in body", "image", { prompt: "p", mapping: syntheticMapping() }],
  ])("%s is a 400 with no launch", async (_name, kind, body) => {
    const run = setup();
    const model = kind === "video" ? "synthetic-video" : "synthetic-image";
    const result = await run[kind].generate({ model, body, credentials: run.credentials });
    expect(result).toMatchObject({ success: false, status: 400 });
    expect(result.acceptedJob).toBeUndefined();
    expect(run.launcher.launches).toEqual([]);
  });

  it("refuses a disabled guard, missing mapping, wrong-kind model or supplied cookie with no launch", async () => {
    const cases = [
      [{ config: { enabled: false } }, "synthetic-image", 403],
      [{ mapping: null }, "synthetic-image", 400],
      [{}, "synthetic-video", 400],
      [{ extra: { cookie: "synthetic=1" } }, "synthetic-image", 400],
    ];
    for (const [overrides, model, expected] of cases) {
      const run = setup({ connectionId: `conn-${expected}-${model}-${Object.keys(overrides).join("")}`, credentials: overrides });
      const result = await run.image.generate({ model, body: { prompt: "p" }, credentials: run.credentials });
      expect(result.status, JSON.stringify(overrides)).toBe(expected);
      expect(run.launcher.launches).toEqual([]);
    }
  });

  it("a pre-submit abort has no accepted job", async () => {
    const run = setup();
    const controller = new AbortController();
    controller.abort();
    const result = await run.image.generate({ model: "synthetic-image", body: { prompt: "p" }, credentials: run.credentials, signal: controller.signal });
    expect(result).toMatchObject({ success: false, status: 499 });
    expect(result.acceptedJob).toBeUndefined();
    expect(run.launcher.launches).toEqual([]);
    expect(journal.list()).toEqual([]);
  });
});

describe("operator stop states before submit", () => {
  it.each([
    ["sign-in dialog", (page) => page.add({ role: "dialog", name: "Synthetic sign in" })],
    ["challenge", (page) => page.add({ role: "alert", name: "Synthetic challenge" })],
    ["redirect to another origin", (page) => { page.onGoto = (p) => { p.currentUrl = "https://auth.synthetic.invalid/login"; }; }],
    ["consent after model selection", (page) => {
      const option = page.elements.find((element) => element.name === "Synthetic Image Label");
      option.onClick = (p) => { p.add({ role: "dialog", name: "Synthetic sign in" }); };
    }],
    ["ambiguous prompt", (page) => page.add({ role: "textbox", name: "Synthetic prompt" })],
    ["missing submit", (page) => page.remove(page.elements.find((element) => element.name === "Synthetic generate"))],
    ["disabled submit", (page) => { page.elements.find((element) => element.name === "Synthetic generate").enabled = false; }],
    ["missing requested model", (page) => page.remove(page.elements.find((element) => element.name === "Synthetic Image Label"))],
    ["unmappable existing results", (page) => { addResult(page, { id: "old" }); addResult(page, { id: "old" }); }],
  ])("%s is 409 needs_operator with no submit and nothing clicked through", async (_name, pageSetup) => {
    const run = setup({ page: pageSetup });
    const result = await run.image.generate({ model: "synthetic-image", body: { prompt: "p" }, credentials: run.credentials });
    expect(result).toMatchObject({ success: false, status: 409, outcome: "needs_operator" });
    expect(result.acceptedJob).toBeUndefined();
    const page = run.page();
    expect(submits(page)).toBe(0);
    expect(page.calls.some(([kind, name]) => kind === "click" && /sign in|challenge/i.test(name ?? ""))).toBe(false);
    expect(journal.list()).toEqual([]);
    expect(run.launcher.launches[0].context.closeCalls).toBe(1);
  });

  it("without identityAttr, existing results are refused before submit; an empty baseline is accepted", async () => {
    const mapping = syntheticMapping({ locators: { identityAttr: undefined } });
    delete mapping.locators.identityAttr;
    const blocked = setup({ connectionId: "conn-blocked", credentials: { mapping }, page: (page) => addResult(page, { identity: false }) });
    const refused = await blocked.image.generate({ model: "synthetic-image", body: { prompt: "p" }, credentials: blocked.credentials });
    expect(refused).toMatchObject({ status: 409, outcome: "needs_operator" });
    expect(submits(blocked.page())).toBe(0);

    const fresh = setup({ connectionId: "conn-fresh", credentials: { mapping }, workspace: { identity: false } });
    const done = await fresh.image.generate({ model: "synthetic-image", body: { prompt: "p" }, credentials: fresh.credentials });
    expect(done.success).toBe(true);
  });
});

describe("one submit, unknown outcomes", () => {
  const unknown = (result, status) => {
    expect(result).toMatchObject({ success: false, status, outcome: "outcome_unknown" });
    expect(result.acceptedJob).toMatchObject({ costSource: "accepted-job", cost: null, costStatus: "unknown", nativeUnits: {}, meta: { jobState: "outcome_unknown" } });
    expect(result.accounting).toBeUndefined();
  };

  it.each([
    ["two new items", { onSubmit: (page) => { addResult(page); addResult(page); } }],
    ["an earlier result changing identity", {
      page: (page) => addResult(page, { id: "old-1" }),
      onSubmit: (page) => {
        // The old item changes identity: the baseline is no longer stable.
        page.elements.find((element) => element.attrs?.["data-synthetic-id"] === "old-1").attrs["data-synthetic-id"] = "old-1-changed";
      },
    }],
    ["the baseline item disappears", { page: (page) => addResult(page, { id: "old-2" }), onSubmit: (page) => page.remove(page.elements.find((element) => element.attrs?.["data-synthetic-id"] === "old-2")) }],
    ["a duplicate identity", { onSubmit: (page) => { addResult(page, { id: "dup" }); addResult(page, { id: "dup" }); } }],
    ["a new item without identity", { onSubmit: (page) => addResult(page, { identity: false }) }],
    ["two download controls", { onSubmit: (page) => {
      const item = addResult(page);
      page.add({ role: "button", name: "Synthetic download", parent: item.id });
    } }],
    ["navigation away", { onSubmit: (page) => { page.currentUrl = "https://elsewhere.synthetic.invalid/"; } }],
    ["a challenge after submit", { onSubmit: (page) => page.add({ role: "alert", name: "Synthetic challenge" }) }],
    ["a failed download", { onSubmit: (page) => addResult(page, { download: new FakeDownload(PNG, { failure: "synthetic failure" }) }) }],
    ["an HTML file instead of an image", { onSubmit: (page) => addResult(page, { bytes: HTML }) }],
    ["a video file on the image route", { onSubmit: (page) => addResult(page, { bytes: MP4 }) }],
    ["an oversized file", { limits: { maxImageBytes: 1024 }, onSubmit: (page) => addResult(page, { bytes: Buffer.concat([PNG, Buffer.alloc(2048)]) }) }],
    ["the submit click itself failing", { onSubmit: () => { throw new Error("synthetic click failure at /private/path"); } }],
  ])("%s is outcome_unknown, never resubmitted and not counted", async (_name, { page: pageSetup, onSubmit, limits }) => {
    const run = setup({ page: pageSetup, workspace: { onSubmit }, credentials: limits ? { limits } : {} });
    const result = await run.image.generate({ model: "synthetic-image", body: { prompt: "p" }, credentials: run.credentials });
    unknown(result, 502);
    expect(submits(run.page())).toBe(1);
    expect(result.error).not.toMatch(/private\/path|synthetic\.invalid/);
    const [entry] = journal.unknownOutcomes();
    expect(entry).toMatchObject({ state: "outcome_unknown", correlationId: result.correlationId, connectionId: "conn-a" });
    expect(run.launcher.launches[0].context.closeCalls).toBe(1);
    expect(leftovers()).toEqual([]);
  });

  it("records the correlation before the single submit click", async () => {
    const run = setup({ workspace: { onSubmit: (page) => {
      page.record("journal-at-submit", journal.list().map(({ state }) => state));
      addResult(page);
    } } });
    await run.image.generate({ model: "synthetic-image", body: { prompt: "p" }, credentials: run.credentials });
    expect(run.page().calls).toContainEqual(["journal-at-submit", ["submitting"]]);
  });

  it("an abort after submit is outcome_unknown with an accepted job and closes the context", async () => {
    const controller = new AbortController();
    const run = setup({ workspace: { onSubmit: () => setTimeout(() => controller.abort(), 0) } });
    const result = await run.video.generate({ model: "synthetic-video", body: { prompt: "p" }, credentials: run.credentials, signal: controller.signal });
    unknown(result, 499);
    expect(result.acceptedJob.modality).toBe("video");
    expect(submits(run.page())).toBe(1);
    expect(run.launcher.launches[0].context.closeCalls).toBe(1);
  });

  it("a result that never becomes ready hits the deadline as outcome_unknown (stale ready is not reused)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const run = setup({
      credentials: { limits: { timeoutMs: 10_000, navigationTimeoutMs: 1_000, downloadTimeoutMs: 1_000, pollIntervalMs: 500 } },
      page: (page) => addResult(page, { id: "old-ready" }),
      workspace: { onSubmit: (page) => addResult(page, { ready: false }) },
    });
    const pending = run.image.generate({ model: "synthetic-image", body: { prompt: "p" }, credentials: run.credentials });
    await vi.advanceTimersByTimeAsync(11_000);
    const result = await pending;
    unknown(result, 504);
    expect(submits(run.page())).toBe(1);
    expect(run.page().calls.filter(([kind, name]) => kind === "click" && name === "Synthetic download")).toEqual([]);
  });

  it("a non-cooperative page call after submit is bounded and cleaned up", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const run = setup({
      credentials: { limits: { timeoutMs: 10_000, navigationTimeoutMs: 1_000, actionTimeoutMs: 1_000, downloadTimeoutMs: 1_000 } },
      workspace: { onSubmit: (page) => { page.hangs.add("count"); } },
    });
    const pending = run.image.generate({ model: "synthetic-image", body: { prompt: "p" }, credentials: run.credentials });
    await vi.advanceTimersByTimeAsync(12_000);
    const result = await pending;
    unknown(result, 504);
    expect(run.launcher.launches[0].context.closeCalls).toBe(1);
  });

  it("a hanging download save is bounded, outcome_unknown, and leaves no temp files", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const run = setup({
      credentials: { limits: { timeoutMs: 10_000, navigationTimeoutMs: 1_000, downloadTimeoutMs: 2_000 } },
      workspace: { onSubmit: (page) => addResult(page, { download: new FakeDownload(PNG, { hangSave: true }) }) },
    });
    const pending = run.image.generate({ model: "synthetic-image", body: { prompt: "p" }, credentials: run.credentials });
    await vi.advanceTimersByTimeAsync(12_000);
    const result = await pending;
    unknown(result, 504);
    expect(leftovers()).toEqual([]);
  });

  it("a non-cooperative navigation before submit is a 504 with no accepted job", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const run = setup({ credentials: { limits: { timeoutMs: 10_000, navigationTimeoutMs: 1_000, downloadTimeoutMs: 1_000 } }, page: (page) => page.hangs.add("goto") });
    const pending = run.image.generate({ model: "synthetic-image", body: { prompt: "p" }, credentials: run.credentials });
    await vi.advanceTimersByTimeAsync(2_000);
    const result = await pending;
    expect(result).toMatchObject({ success: false, status: 504, outcome: "timeout" });
    expect(result.acceptedJob).toBeUndefined();
    expect(journal.list()).toEqual([]);
    expect(run.launcher.launches[0].context.closeCalls).toBe(1);
  });
});
