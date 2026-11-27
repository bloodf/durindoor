// SYNTHETIC fake browser for the staged Firefly web UI flow tests (#2034).
// Nothing here is Adobe markup or observed Adobe behavior: it is a minimal
// in-memory accessibility tree with role/name/label lookups, clicks, fills,
// one download event and recorded calls. No real browser or network is used.
import fs from "node:fs";

export const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("synthetic-png-bytes")]);
export const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("synthetic-jpeg-bytes")]);
export const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.from("synthetic-mp4-bytes")]);
export const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.from("....webm synthetic-webm-bytes")]);
export const HTML = Buffer.from("<!doctype html><title>synthetic error page</title>");

export const SYNTHETIC_ORIGIN = "https://firefly.adobe.com";

let nextId = 0;

export class FakeElement {
  constructor({ role, name, label, attrs = {}, visible = true, enabled = true, parent = null, onClick = null }) {
    this.id = ++nextId;
    Object.assign(this, { role, name, label, attrs, visible, enabled, parent, onClick });
  }
}

function matches(element, query) {
  if (query.label !== undefined) return element.label === query.label;
  if (element.role !== query.role) return false;
  return query.name === undefined || element.name === query.name;
}

class FakeLocator {
  constructor(page, query, parent = null, index = null) {
    Object.assign(this, { page, query, parent, index });
  }

  resolve() {
    const all = this.page.elements.filter((element) => matches(element, this.query) && (this.parent === null || element.parent === this.parent));
    return this.index === null ? all : all.slice(this.index, this.index + 1);
  }

  single(action) {
    const found = this.resolve();
    if (found.length !== 1) throw new Error(`strict mode violation in synthetic ${action}`);
    return found[0];
  }

  async count() { await this.page.hang("count"); return this.resolve().length; }
  nth(index) { return new FakeLocator(this.page, this.query, this.parent, index); }
  async isVisible() { return this.resolve()[0]?.visible === true; }
  async isEnabled() { return this.resolve()[0]?.enabled === true; }
  async getAttribute(name) { return this.single("getAttribute").attrs[name] ?? null; }

  async click(options) {
    if (options !== undefined) this.page.record("click-options", options);
    const element = this.single("click");
    this.page.record("click", element.name ?? element.label);
    await this.page.hang("click", element.name ?? element.label);
    await element.onClick?.(this.page, element);
  }

  async fill(value) {
    const element = this.single("fill");
    this.page.record("fill", element.name ?? element.label);
    element.value = value;
  }

  getByRole(role, options = {}) {
    const item = this.single("scope");
    this.page.record("getByRole", role, options);
    return new FakeLocator(this.page, { role, name: options.name }, item.id);
  }

  getByLabel(label, options = {}) {
    const item = this.single("scope");
    this.page.record("getByLabel", label, options);
    return new FakeLocator(this.page, { label }, item.id);
  }
}

export class FakeDownload {
  constructor(bytes, { failure = null, hangSave = false } = {}) {
    Object.assign(this, { bytes, failureReason: failure, hangSave, deleted: 0, savedTo: null });
  }

  async failure() { return this.failureReason; }
  url() { return "https://synthetic.invalid/never-fetched"; }
  suggestedFilename() { return "synthetic.bin"; }
  async saveAs(target) {
    if (this.hangSave) return new Promise(() => {});
    this.savedTo = target;
    fs.writeFileSync(target, this.bytes);
  }
  async delete() { this.deleted++; }
}

export class FakePage {
  constructor(context, { url = `${SYNTHETIC_ORIGIN}/` } = {}) {
    Object.assign(this, { context, currentUrl: url, elements: [], calls: [], closed: false, closeCalls: 0, waiters: [], hangs: new Set(), onGoto: null });
  }

  record(...entry) { this.calls.push(entry); }
  hang(kind, name) { return this.hangs.has(kind) || this.hangs.has(`${kind}:${name}`) ? new Promise(() => {}) : undefined; }
  url() { return this.currentUrl; }
  isClosed() { return this.closed; }

  async goto(url, options) {
    this.record("goto", url, options);
    if (this.hangs.has("goto")) return new Promise(() => {});
    if (this.onGoto) await this.onGoto(this, url);
    else this.currentUrl = url;
    return null;
  }

  add(spec) {
    const element = new FakeElement(spec);
    this.elements.push(element);
    return element;
  }

  remove(element) { this.elements = this.elements.filter((candidate) => candidate !== element && candidate.parent !== element.id); }

  getByRole(role, options = {}) {
    this.record("getByRole", role, options);
    return new FakeLocator(this, { role, name: options.name });
  }

  getByLabel(label, options = {}) {
    this.record("getByLabel", label, options);
    return new FakeLocator(this, { label });
  }

  waitForEvent(event, options) {
    this.record("waitForEvent", event, options);
    return new Promise((resolve) => this.waiters.push({ event, resolve }));
  }

  emitDownload(download) {
    for (const waiter of this.waiters.splice(0)) if (waiter.event === "download") waiter.resolve(download);
  }

  async close() { this.closeCalls++; this.closed = true; }

  // Forbidden surfaces: any use is recorded so tests can assert none happened.
  async evaluate() { this.record("evaluate"); }
  async addInitScript() { this.record("addInitScript"); }
  async setExtraHTTPHeaders() { this.record("setExtraHTTPHeaders"); }
  async route() { this.record("route"); }
  async keyboard() { this.record("keyboard"); }
}

export class FakeContext {
  constructor(dir, options, setupPage) {
    Object.assign(this, { dir, options, closeCalls: 0, closed: false, listeners: {}, created: [], forbidden: [], hangClose: false });
    this.initialPage = new FakePage(this);
    setupPage?.(this.initialPage);
  }

  pages() { return [this.initialPage]; }

  async newPage() {
    this.created.push(this.initialPage);
    return this.initialPage;
  }

  on(event, listener) { (this.listeners[event] ||= []).push(listener); }

  async close() {
    this.closeCalls++;
    if (this.hangClose) return new Promise(() => {});
    this.closed = true;
    this.initialPage.closed = true;
    for (const listener of this.listeners.close || []) listener();
  }

  async cookies() { this.forbidden.push("cookies"); return []; }
  async storageState() { this.forbidden.push("storageState"); return {}; }
  async addCookies() { this.forbidden.push("addCookies"); }
  async addInitScript() { this.forbidden.push("addInitScript"); }
  async setExtraHTTPHeaders() { this.forbidden.push("setExtraHTTPHeaders"); }
}

/** A launcher that records every launch and hands back a scripted context. */
export function fakeLauncher(setupPage) {
  const launches = [];
  return {
    launches,
    async launchPersistentContext(dir, options) {
      const context = new FakeContext(dir, options, setupPage);
      launches.push({ dir, options, context });
      return context;
    },
  };
}

/**
 * The synthetic control layout matching syntheticMapping(): prompt, model
 * picker, two model options, submit, and a stop-marker-free page. Submit adds
 * a result item after `delayPolls` observations, then a ready marker and a
 * download control that emits `bytes`.
 */
export function syntheticWorkspace(page, { bytes = PNG, download, identity = true, onSubmit } = {}) {
  page.add({ role: "textbox", name: "Synthetic prompt" });
  page.add({ role: "combobox", name: "Synthetic model", onClick: (p) => p.record("picker-open") });
  page.add({ role: "option", name: "Synthetic Image Label" });
  page.add({ role: "option", name: "Synthetic Video Label" });
  page.add({ role: "button", name: "Synthetic generate", onClick: onSubmit ?? ((p) => addResult(p, { bytes, download, identity })) });
}

let resultCounter = 0;

/** Add one synthetic result item, ready, with a download control. */
export function addResult(page, { bytes = PNG, download, identity = true, ready = true, id } = {}) {
  const item = page.add({ role: "listitem", name: "Synthetic result", attrs: identity ? { "data-synthetic-id": id ?? `new-${++resultCounter}` } : {} });
  if (ready) page.add({ role: "img", name: "Synthetic ready", parent: item.id });
  page.add({
    role: "button",
    name: "Synthetic download",
    parent: item.id,
    onClick: (p) => p.emitDownload(download ?? new FakeDownload(bytes)),
  });
  return item;
}

/** A clearly synthetic operator mapping for the synthetic workspace above. */
export function syntheticMapping(overrides = {}) {
  return {
    validatedBy: "operator",
    validatedAt: "2026-11-27T00:00:00.000Z",
    locators: {
      prompt: { role: "textbox", name: "Synthetic prompt" },
      submit: { role: "button", name: "Synthetic generate" },
      modelPicker: { role: "combobox", name: "Synthetic model" },
      modelOptionRole: "option",
      resultItem: { role: "listitem", name: "Synthetic result" },
      identityAttr: "data-synthetic-id",
      resultReady: { role: "img", name: "Synthetic ready" },
      download: { role: "button", name: "Synthetic download" },
      stopMarkers: [{ role: "dialog", name: "Synthetic sign in" }, { role: "alert", name: "Synthetic challenge" }],
      ...overrides.locators,
    },
    ...(overrides.startPaths ? { startPaths: overrides.startPaths } : {}),
  };
}

export const SYNTHETIC_MODEL_MAP = Object.freeze({
  "synthetic-image": { label: "Synthetic Image Label", kind: "image" },
  "synthetic-video": { label: "Synthetic Video Label", kind: "video" },
});

/** Stored connection credentials with a synthetic config. */
export function syntheticCredentials({ connectionId = "conn-a", profileHandle, mapping = syntheticMapping(), modelMap = SYNTHETIC_MODEL_MAP, limits, extra = {}, config = {} } = {}) {
  return {
    connectionId,
    providerSpecificData: {
      fireflyWebUi: { enabled: true, profileHandle, mapping, modelMap, limits: { pollIntervalMs: 50, ...limits }, ...config },
      ...extra,
    },
  };
}
