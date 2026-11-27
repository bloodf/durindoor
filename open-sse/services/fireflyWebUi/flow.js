// One guarded generation through the Firefly web UI (#2034, staged).
//
// Contract: internal/docs/firefly-consumer-browser-contract.md. Order:
//   1. Config, request, credentials and profile are validated, and the
//      profile is taken, before any browser launch (config.js, profile.js).
//   2. An ordinary Chromium opens the profile (browser.js) on the fixed
//      Firefly origin. Any other origin, or a visible operator stop marker
//      (sign-in, MFA, challenge, consent, entitlement), is 409 needs_operator:
//      nothing is clicked through.
//   3. Prompt, submit, the model picker and the requested model's option must
//      each match exactly one actionable element. Existing result items are
//      snapshotted: with no identity attribute there must be none; with one,
//      their ids must be unique, bounded and stable.
//   4. A local correlation is recorded, then submit is clicked exactly once.
//      From then on every failure, abort, deadline or ambiguity is
//      outcome_unknown with accepted-job accounting, and nothing is replayed.
//   5. Exactly one new result item, with exactly one ready marker and one
//      download control inside it, is downloaded through the UI's own
//      download event (never a URL fetch) to an owned temporary directory,
//      bounded in time and size, and type-checked from its magic bytes.
//   6. Only that validated artifact is returned and counted, once.
//
// Errors never carry page URLs, file paths, profile details or Playwright
// messages; they use fixed reasons.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createErrorResult } from "../../utils/error.js";
import { mediaAccounting } from "../../handlers/mediaAccounting.js";
import { ADOBE_FIREFLY_WEB_ID, ADOBE_FIREFLY_WEB_ORIGIN } from "../../providers/registry/adobe-firefly-web.js";
import { parseFireflyWebUiConfig, prepareFireflyWebUiRequest } from "./config.js";
import { acquireProfile, assertConnectionId, resolveProfile } from "./profile.js";
import { GENERATION_LAUNCH_OPTIONS, launchOwnedContext, playwrightLauncher } from "./browser.js";
import { detectArtifact, readOwnedArtifact } from "./artifact.js";
import { defaultFireflyWebUiJournal } from "./journal.js";
import { isFunction, isString } from "../../../src/shared/utils/typeChecks.js";

const RESULT_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const MAX_MARKER_MATCHES = 20;

class Stop extends Error {
  constructor(kind, reason) {
    super(reason);
    this.kind = kind;
  }
}

// Bounds every browser call by its own timeout, the overall deadline and the
// caller's signal. A call that never settles cannot hold the request: the
// race ends, and cleanup closes the context it belongs to.
class Guard {
  constructor(signal, deadlineAt) {
    this.signal = signal;
    this.deadlineAt = deadlineAt;
  }

  check() {
    if (this.signal?.aborted) throw new Stop("abort", "request aborted");
    if (Date.now() >= this.deadlineAt) throw new Stop("deadline", "deadline reached");
  }

  run(work, timeoutMs, reason) {
    this.check();
    const promise = Promise.resolve().then(() => (isFunction(work) ? work() : work));
    promise.catch(() => {});
    const ms = Math.max(0, Math.min(timeoutMs, this.deadlineAt - Date.now()));
    let timer;
    let onAbort;
    const stop = new Promise((_, rejectStop) => {
      timer = setTimeout(() => rejectStop(new Stop(Date.now() >= this.deadlineAt ? "deadline" : "timeout", reason)), ms);
      onAbort = () => rejectStop(new Stop("abort", "request aborted"));
      this.signal?.addEventListener?.("abort", onAbort, { once: true });
    });
    return Promise.race([
      promise.catch((error) => { throw error instanceof Stop ? error : new Stop("failed", reason); }),
      stop,
    ]).finally(() => {
      clearTimeout(timer);
      this.signal?.removeEventListener?.("abort", onAbort);
    });
  }

  sleep(ms) {
    return this.run(new Promise((resolve) => setTimeout(resolve, ms)), ms + 1, "wait").catch((error) => {
      if (error.kind === "timeout") return;
      throw error;
    });
  }
}

/** A Playwright locator for a role/name or label spec, under `scope`. */
export function locate(scope, spec, name) {
  if (spec.label !== undefined) return scope.getByLabel(spec.label, { exact: spec.exact });
  const accessibleName = name ?? spec.name;
  return scope.getByRole(spec.role, accessibleName === undefined ? {} : { name: accessibleName, exact: spec.exact });
}

const unknownMessage = (reason) => `Adobe Firefly web UI outcome unknown after submit (${reason}); it was not resubmitted`;

function acceptedJob(kind, reason, correlationId) {
  return { ...mediaAccounting(null, ADOBE_FIREFLY_WEB_ID, kind), costSource: "accepted-job", meta: { jobState: "outcome_unknown", reason, correlationId } };
}

function failure(error) {
  const status = Number.isInteger(error?.status) ? error.status : 502;
  const message = error?.outcome ? error.message : "Adobe Firefly web UI browser step failed before submit";
  return { ...createErrorResult(status, message), outcome: error?.outcome ?? "failed" };
}

function stopBeforeSubmit(stop) {
  if (stop.kind === "abort") return { ...createErrorResult(499, "Adobe Firefly web UI request aborted before submit"), outcome: "aborted" };
  if (stop.kind === "deadline" || stop.kind === "timeout") {
    return { ...createErrorResult(504, `Adobe Firefly web UI timed out before submit (${stop.message})`), outcome: "timeout" };
  }
  return { ...createErrorResult(502, `Adobe Firefly web UI ${stop.message} failed before submit`), outcome: "failed" };
}

const needsOperator = (reason) => Object.assign(new Error(`Adobe Firefly web UI needs operator action: ${reason}; nothing was submitted`), { status: 409, outcome: "needs_operator" });

function onOrigin(page) {
  try {
    return new URL(page.url()).origin === ADOBE_FIREFLY_WEB_ORIGIN;
  } catch {
    return false;
  }
}

/**
 * Run one generation. Returns `{ success: true, response, accounting }` or an
 * error result; a failure after submit carries `acceptedJob`.
 *
 * @param {object} options
 * @param {"image"|"video"} options.kind
 * @param {object} [options.deps] - `launcher`, `dataDir`, `journal`, `tmpRoot`; injectable for tests
 */
export async function runFireflyWebUiGeneration({ kind, model, body, credentials, signal, log, deps = {} }) {
  const launcher = deps.launcher ?? playwrightLauncher;
  const journal = deps.journal ?? defaultFireflyWebUiJournal;
  let config;
  let request;
  let release;
  try {
    config = parseFireflyWebUiConfig(credentials);
    request = prepareFireflyWebUiRequest(config, { kind, model, body });
    const connectionId = assertConnectionId(credentials?.connectionId);
    const dataDir = isFunction(deps.dataDir) ? await deps.dataDir() : deps.dataDir;
    const dir = resolveProfile({ dataDir, connectionId, profileHandle: config.profileHandle });
    release = acquireProfile(dir, "generation");
    request = { ...request, connectionId, dir };
  } catch (error) {
    return failure(error);
  }
  if (signal?.aborted) {
    release();
    return stopBeforeSubmit(new Stop("abort", "request aborted"));
  }

  const { limits, mapping } = config;
  const { locators } = mapping;
  const guard = new Guard(signal, Date.now() + limits.timeoutMs);
  const maxBytes = kind === "video" ? limits.maxVideoBytes : limits.maxImageBytes;
  let owned = null;
  let page = null;
  let download = null;
  let tmpDir = null;
  let correlation = null;
  let abandonedLaunch = null;

  const actionable = async (locator, what) => {
    const count = await guard.run(() => locator.count(), limits.actionTimeoutMs, `${what} lookup`);
    if (count !== 1) throw needsOperator(`${what} matched ${count} elements instead of exactly one`);
    const visible = await guard.run(() => locator.isVisible(), limits.actionTimeoutMs, `${what} lookup`);
    const enabled = await guard.run(() => locator.isEnabled(), limits.actionTimeoutMs, `${what} lookup`);
    if (!visible || !enabled) throw needsOperator(`${what} is not actionable`);
    return locator;
  };

  const stopMarkerVisible = async () => {
    for (const spec of locators.stopMarkers) {
      const locator = locate(page, spec);
      const count = Math.min(await guard.run(() => locator.count(), limits.actionTimeoutMs, "stop marker lookup"), MAX_MARKER_MATCHES);
      for (let index = 0; index < count; index++) {
        if (await guard.run(() => locator.nth(index).isVisible(), limits.actionTimeoutMs, "stop marker lookup")) return true;
      }
    }
    return false;
  };

  // The result items now: `{ items, ids }`, or null when they cannot be told apart.
  const readItems = async () => {
    const locator = locate(page, locators.resultItem);
    const count = await guard.run(() => locator.count(), limits.actionTimeoutMs, "result lookup");
    if (!Number.isInteger(count) || count < 0 || count > limits.maxResultItems) return null;
    const items = Array.from({ length: count }, (_, index) => locator.nth(index));
    if (!locators.identityAttr) return { items, ids: null };
    const ids = [];
    for (const item of items) {
      const id = await guard.run(() => item.getAttribute(locators.identityAttr), limits.actionTimeoutMs, "result lookup");
      if (!isString(id) || !RESULT_ID.test(id)) return null;
      ids.push(id);
    }
    return new Set(ids).size === ids.length ? { items, ids } : null;
  };

  const preState = async () => {
    if (!onOrigin(page)) throw needsOperator("the page left the Firefly origin (sign-in or redirect)");
    if (await stopMarkerVisible()) throw needsOperator("a sign-in, challenge, consent or entitlement marker is visible");
  };

  try {
    const launching = launchOwnedContext(launcher, request.dir, GENERATION_LAUNCH_OPTIONS);
    try {
      owned = await guard.run(launching, limits.navigationTimeoutMs, "browser launch");
    } catch (error) {
      // A launch that finishes after we gave up is still ours to close, and
      // the profile stays taken until it is closed.
      abandonedLaunch = launching.then((late) => late.close(), () => {});
      throw error;
    }
    page = await guard.run(() => owned.context.newPage(), limits.actionTimeoutMs, "page open");
    const startUrl = new URL(mapping.startPaths[kind], ADOBE_FIREFLY_WEB_ORIGIN).href;
    await guard.run(() => page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: limits.navigationTimeoutMs }), limits.navigationTimeoutMs, "navigation");
    await preState();

    const picker = await actionable(locate(page, locators.modelPicker), "model picker");
    await guard.run(() => picker.click(), limits.actionTimeoutMs, "model picker");
    const option = await actionable(locate(page, { role: locators.modelOptionRole, exact: true }, request.label), "requested model");
    await guard.run(() => option.click(), limits.actionTimeoutMs, "model selection");
    await preState();

    const prompt = await actionable(locate(page, locators.prompt), "prompt");
    await guard.run(() => prompt.fill(request.prompt), limits.actionTimeoutMs, "prompt entry");
    await preState();
    const submit = await actionable(locate(page, locators.submit), "submit");

    const baseline = await readItems();
    if (!baseline) throw needsOperator("existing results cannot be told apart (ambiguous or unbounded identities)");
    if (!locators.identityAttr && baseline.items.length !== 0) {
      throw needsOperator("existing results are on the page and mapping.locators.identityAttr is not set");
    }
    const baselineIds = new Set(baseline.ids ?? []);

    guard.check();
    correlation = journal.record({ connectionId: request.connectionId, model, kind });
    log?.info?.("FIREFLY-WEB", `submit ${correlation.correlationId} | ${model}`);
    // From here the submit may have been taken: never click it again.
    await guard.run(() => submit.click(), limits.actionTimeoutMs, "submit");
    journal.update(correlation.correlationId, "submitted");

    let downloadControl = null;
    while (!downloadControl) {
      guard.check();
      if (page.isClosed?.() || !onOrigin(page)) throw new Stop("lost", "the page navigated away or closed");
      if (await stopMarkerVisible()) throw new Stop("operator", "an operator marker appeared after submit");
      const now = await readItems();
      if (!now) throw new Stop("ambiguous", "result items became ambiguous");
      let fresh;
      if (now.ids) {
        if ([...baselineIds].some((id) => !now.ids.includes(id))) throw new Stop("ambiguous", "earlier results changed");
        fresh = now.items.filter((_, index) => !baselineIds.has(now.ids[index]));
      } else {
        fresh = now.items;
      }
      if (fresh.length > 1) throw new Stop("ambiguous", "more than one new result appeared");
      if (fresh.length === 1) {
        const item = fresh[0];
        const ready = await guard.run(() => locate(item, locators.resultReady).count(), limits.actionTimeoutMs, "result lookup");
        if (ready > 1) throw new Stop("ambiguous", "the new result has more than one ready marker");
        if (ready === 1) {
          const control = locate(item, locators.download);
          const controls = await guard.run(() => control.count(), limits.actionTimeoutMs, "result lookup");
          if (controls > 1) throw new Stop("ambiguous", "the new result has more than one download control");
          if (controls === 1) downloadControl = control;
        }
      }
      if (!downloadControl) await guard.sleep(limits.pollIntervalMs);
    }

    const downloadTimeout = Math.min(limits.downloadTimeoutMs, limits.timeoutMs);
    const event = Promise.resolve().then(() => page.waitForEvent("download", { timeout: downloadTimeout }));
    event.catch(() => {});
    await guard.run(() => downloadControl.click(), limits.actionTimeoutMs, "download");
    download = await guard.run(event, downloadTimeout, "download");
    if (await guard.run(() => download.failure(), downloadTimeout, "download")) throw new Stop("download", "the download failed");
    tmpDir = fs.mkdtempSync(path.join(deps.tmpRoot ?? os.tmpdir(), "durindoor-firefly-"));
    fs.chmodSync(tmpDir, 0o700);
    const file = path.join(tmpDir, "artifact");
    await guard.run(() => download.saveAs(file), downloadTimeout, "download");
    const bytes = readOwnedArtifact(file, tmpDir, maxBytes);
    if (!bytes) throw new Stop("download", "the download was missing, empty or too large");
    const artifact = detectArtifact(kind, bytes);
    if (!artifact) throw new Stop("download", `the download is not a supported ${kind}`);

    journal.update(correlation.correlationId, "completed");
    const accounting = mediaAccounting(null, ADOBE_FIREFLY_WEB_ID, kind);
    accounting.nativeUnits[kind === "video" ? "videos" : "images"] = 1;
    accounting.meta.nativeUnitsSource = kind === "video" ? "returned-videos" : "returned-images";
    const payload = {
      created: Math.floor(Date.now() / 1000),
      data: [{ b64_json: bytes.toString("base64"), mime_type: artifact.mime, output_format: artifact.format }],
    };
    return {
      success: true,
      accounting,
      response: new Response(JSON.stringify(payload), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }),
    };
  } catch (error) {
    if (correlation) {
      const reason = error instanceof Stop ? error.message : "browser step failed";
      journal.update(correlation.correlationId, "outcome_unknown", reason);
      const status = error?.kind === "abort" ? 499 : error?.kind === "deadline" || error?.kind === "timeout" ? 504 : 502;
      return {
        ...createErrorResult(status, unknownMessage(reason)),
        outcome: "outcome_unknown",
        correlationId: correlation.correlationId,
        acceptedJob: acceptedJob(kind, reason, correlation.correlationId),
      };
    }
    return error instanceof Stop ? stopBeforeSubmit(error) : failure(error);
  } finally {
    if (download) await Promise.resolve().then(() => download.delete()).catch(() => {});
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    if (owned) {
      // The lock is held until the context is really closed; a context that
      // never closes leaves its profile busy rather than shared.
      const closed = owned.close();
      closed.then(release);
      let timer;
      await Promise.race([closed, new Promise((resolve) => { timer = setTimeout(resolve, limits.actionTimeoutMs); })]);
      clearTimeout(timer);
    } else if (abandonedLaunch) {
      abandonedLaunch.then(release);
    } else {
      release();
    }
  }
}
