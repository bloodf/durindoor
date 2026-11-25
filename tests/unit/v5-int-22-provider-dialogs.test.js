// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
const route = vi.hoisted(() => ({ id: "openrouter" }));
vi.mock("next/navigation", () => ({ useParams: () => ({ id: route.id }), useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }) }));
import ProviderDetailError from "../../src/app/(dashboard)/dashboard/providers/[id]/error.js";
// Load every component during collection. Cold-transforming this module graph inside a test body
// can exceed testTimeout on a loaded host; the timed-out body then keeps rendering into the shared
// document and breaks every later test.
import * as AddSystemoneCompatibleModalModule from "../../src/shared/components/AddSystemoneCompatibleModal.js";
import * as BulkReviewModalModule from "../../src/app/(dashboard)/dashboard/providers/[id]/components/BulkReviewModal.js";
import * as AddCompatibleModalModule from "../../src/app/(dashboard)/dashboard/providers/components/AddCompatibleModal.js";
import * as AutoPingScheduleModalModule from "../../src/app/(dashboard)/dashboard/providers/[id]/AutoPingScheduleModal.js";
import * as BulkImportCodexModalModule from "../../src/app/(dashboard)/dashboard/providers/[id]/BulkImportCodexModal.js";
import * as BulkImportGrokCliModalModule from "../../src/app/(dashboard)/dashboard/providers/[id]/BulkImportGrokCliModal.js";
import * as VisibleModelsModalModule from "../../src/app/(dashboard)/dashboard/providers/[id]/VisibleModelsModal.js";
import * as ProviderErrorRulesModalModule from "../../src/app/(dashboard)/dashboard/providers/[id]/ProviderErrorRulesModal.js";
import * as EditCompatibleNodeModalModule from "../../src/app/(dashboard)/dashboard/providers/[id]/EditCompatibleNodeModal.js";
import * as EditConnectionModalModule from "../../src/shared/components/EditConnectionModal.js";
import * as AddApiKeyModalModule from "../../src/app/(dashboard)/dashboard/providers/[id]/AddApiKeyModal.js";
import * as AddCustomModelModalModule from "../../src/app/(dashboard)/dashboard/providers/[id]/AddCustomModelModal.js";
import * as CookieImportModalModule from "../../src/app/(dashboard)/dashboard/providers/[id]/CookieImportModal.js";
import * as ProviderPageModule from "../../src/app/(dashboard)/dashboard/providers/[id]/page.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root;
let host;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  host?.remove();
  delete document.documentElement.dataset.ui;
  route.id = "openrouter";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("announces the V5 provider error and retries", async () => {
  document.documentElement.dataset.ui = "v5";
  vi.spyOn(console, "error").mockImplementation(() => {});
  const reset = vi.fn();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(React.createElement(ProviderDetailError, { error: new Error("failed"), reset })));
  const alert = host.querySelector('[role="alert"]');
  expect(alert?.textContent).toContain("Something went wrong");
  expect(alert.querySelector('a').getAttribute('href')).toBe('/dashboard/providers');
  await act(async () => alert.querySelector('button').click());
  expect(reset).toHaveBeenCalledOnce();
});

it("keeps System One edit request identical with V5 on and off", async () => {
  const { default: Modal } = await AddSystemoneCompatibleModalModule;
  const calls = [];
  const fetchMock = vi.fn(async (url, options) => {
    calls.push({ url, method: options.method, body: JSON.parse(options.body) });
    return { ok: true, json: async () => ({ node: {} }) };
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function () { this.setAttribute("open", ""); });
  vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function () { this.removeAttribute("open"); });
  const node = { id: "one", name: "Test", prefix: "test", baseUrl: "http://localhost:3000/v1" };
  for (const v5 of [false, true]) {
    if (v5) document.documentElement.dataset.ui = "v5";
    else delete document.documentElement.dataset.ui;
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root.render(React.createElement(Modal, { isOpen: true, node, onClose: vi.fn() })));
    const form = document.querySelector("#systemone-node-form");
    expect(form.querySelector('input[type="password"]')).toBeTruthy();
    await act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await act(async () => root.unmount());
    root = null;
    host.remove();
    host = null;
  }
  expect(calls).toHaveLength(2);
  expect(calls[1]).toEqual(calls[0]);
  expect(calls[0]).toEqual({ url: "/api/provider-nodes/one", method: "PUT", body: { name: "Test", prefix: "test", baseUrl: "http://localhost:3000/v1" } });
  vi.unstubAllGlobals();
});

it.each([false, true])("preserves bulk review actions with V5 %s", async (v5) => {
  const { default: Modal } = await BulkReviewModalModule;
  if (v5) document.documentElement.dataset.ui = "v5";
  const show = vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function () { this.setAttribute("open", ""); });
  vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function () { this.removeAttribute("open"); });
  const onConfirm = vi.fn();
  const review = { action: "delete", label: "Delete", count: 1, hiddenCount: 0, names: ["First"], ids: ["first"] };
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(React.createElement(Modal, { review, onConfirm, onCancel: vi.fn() })));
  const confirm = [...document.querySelectorAll("button")].find((button) => button.textContent === "Confirm");
  expect(document.querySelector('[aria-label="Affected connections"]').textContent).toContain("First");
  await act(async () => confirm.click());
  expect(onConfirm).toHaveBeenCalledOnce();
  show.mockRestore();
});

it("keeps compatible provider creation requests identical", async () => {
  const { default: Modal } = await AddCompatibleModalModule;
  const calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url, options) => {
    calls.push({ url, method: options.method, body: JSON.parse(options.body) });
    return { ok: true, json: async () => ({ node: {} }) };
  }));
  vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function () { this.setAttribute("open", ""); });
  vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function () { this.removeAttribute("open"); });
  for (const v5 of [false, true]) {
    if (v5) document.documentElement.dataset.ui = "v5";
    else delete document.documentElement.dataset.ui;
    host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
    await act(async () => root.render(React.createElement(Modal, { isOpen: true, variant: "openai", onClose: vi.fn(), onCreated: vi.fn() })));
    const inputs = [...document.querySelectorAll("input")];
    for (const [placeholder, value] of [["OpenAI Compatible (Prod)", "Example"], ["oc-prod", "example"]]) {
      const input = inputs.find((element) => element.placeholder === placeholder);
      await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
    }
    const create = [...document.querySelectorAll("button")].find((button) => button.textContent === "Create");
    expect(create.disabled).toBe(false);
    await act(async () => create.click());
    await act(async () => root.unmount()); root = null; host.remove(); host = null;
  }
  expect(calls).toHaveLength(2);
  expect(calls[1]).toEqual(calls[0]);
  expect(calls[0]).toMatchObject({ url: "/api/provider-nodes", method: "POST", body: { name: "Example", prefix: "example", type: "openai-compatible", apiType: "chat" } });
  vi.unstubAllGlobals();
});

it.each([false, true])("retains schedule save data with V5 %s", async (v5) => {
  const { default: Modal } = await AutoPingScheduleModalModule;
  if (v5) document.documentElement.dataset.ui = "v5";
  vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function () { this.setAttribute("open", ""); });
  vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function () { this.removeAttribute("open"); });
  const onSave = vi.fn().mockResolvedValue(undefined);
  const schedule = { enabled: true, anchor: "09:30", timezone: "UTC", windowHours: 5, slotsPerDay: 3 };
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  await act(async () => root.render(React.createElement(Modal, { isOpen: true, schedule, onSave, onClose: vi.fn() })));
  const save = [...document.querySelectorAll("button")].find((button) => button.textContent === "Save");
  await act(async () => save.click());
  expect(onSave).toHaveBeenCalledWith(schedule);
});

it.each([
  ["BulkImportCodexModal", "/api/oauth/codex/bulk-import", { accounts: [{ accessToken: "example" }], codexFingerprintMode: "session" }],
  ["BulkImportGrokCliModal", "/api/oauth/grok-cli/bulk-import", { accounts: [{ accessToken: "example" }] }],
])("keeps %s import requests identical", async (name, url, expectedBody) => {
  const modules = {
    BulkImportCodexModal: () => BulkImportCodexModalModule,
    BulkImportGrokCliModal: () => BulkImportGrokCliModalModule,
  };
  const { default: Modal } = await modules[name]();
  const calls = [];
  vi.stubGlobal("fetch", vi.fn(async (path, options) => { calls.push({ url: path, method: options.method, body: JSON.parse(options.body) }); return { ok: true, json: async () => ({ success: 1, failed: 0, results: [] }) }; }));
  vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function () { this.setAttribute("open", ""); });
  vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function () { this.removeAttribute("open"); });
  for (const v5 of [false, true]) {
    if (v5) document.documentElement.dataset.ui = "v5"; else delete document.documentElement.dataset.ui;
    host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
    await act(async () => root.render(React.createElement(Modal, { isOpen: true, onClose: vi.fn(), onSuccess: vi.fn() })));
    const input = document.querySelector("textarea");
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(input, '[{"accessToken":"example"}]'); input.dispatchEvent(new Event("input", { bubbles: true })); });
    const button = [...document.querySelectorAll("button")].find((element) => element.textContent === "Import All");
    await act(async () => button.click());
    await act(async () => root.unmount()); root = null; host.remove(); host = null;
  }
  expect(calls).toEqual([{ url, method: "POST", body: expectedBody }, { url, method: "POST", body: expectedBody }]);
  vi.unstubAllGlobals();
});

it("keeps visible model writes identical", async () => {
  const { default: Modal } = await VisibleModelsModalModule;
  const writes = [];
  vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
    if (options.method === "PUT") writes.push({ url, method: options.method, body: JSON.parse(options.body) });
    return { ok: true, json: async () => ({ ids: ["saved-model"] }) };
  }));
  vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function () { this.setAttribute("open", ""); });
  vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function () { this.removeAttribute("open"); });
  for (const v5 of [false, true]) {
    if (v5) document.documentElement.dataset.ui = "v5"; else delete document.documentElement.dataset.ui;
    host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
    await act(async () => root.render(React.createElement(Modal, { isOpen: true, providerId: "openai", providerAlias: "openai", connections: [], onClose: vi.fn() })));
    const save = [...document.querySelectorAll("button")].find((button) => button.textContent === "Save");
    expect(save.disabled).toBe(false);
    await act(async () => save.click());
    await act(async () => root.unmount()); root = null; host.remove(); host = null;
  }
  expect(writes).toEqual(Array(2).fill({ url: "/api/models/enabled", method: "PUT", body: { providerAlias: "openai", ids: ["saved-model"] } }));
  vi.unstubAllGlobals();
});

it("attaches invalid rule feedback to the V5 match field", async () => {
  const { default: Modal } = await ProviderErrorRulesModalModule;
  document.documentElement.dataset.ui = "v5";
  vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function () { this.setAttribute("open", ""); });
  vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function () { this.removeAttribute("open"); });
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  await act(async () => root.render(React.createElement(Modal, { isOpen: true, providerId: "openai", rules: [], onSave: vi.fn(), onClose: vi.fn() })));
  const add = [...document.querySelectorAll("button")].find((button) => button.textContent.includes("Add Rule"));
  await act(async () => add.click());
  const input = document.querySelector('input[placeholder="daily cap hit"]');
  expect(input.getAttribute("aria-invalid")).toBe("true");
  expect(document.getElementById(input.getAttribute("aria-describedby")).textContent).toContain("Match text is required");
});

it.each([
  ["rules", "Save"], ["node", "Save"], ["connection", "Save"],
])("preserves %s save callback with V5 on and off", async (kind, label) => {
  const imports = {
    rules: () => ProviderErrorRulesModalModule,
    node: () => EditCompatibleNodeModalModule,
    connection: () => EditConnectionModalModule,
  };
  const { default: Modal } = await imports[kind]();
  vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function () { this.setAttribute("open", ""); });
  vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function () { this.removeAttribute("open"); });
  const values = [];
  for (const v5 of [false, true]) {
    if (v5) document.documentElement.dataset.ui = "v5"; else delete document.documentElement.dataset.ui;
    const onSave = vi.fn(async (value) => { values.push(value); });
    const props = { isOpen: true, onSave, onClose: vi.fn(), providerId: "openai", rules: [], node: { id: "node", name: "Example", prefix: "example", baseUrl: "https://example.com/v1" }, connection: { id: "connection", provider: "openai", authType: "apikey", name: "Example", priority: 1, providerSpecificData: {} } };
    host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
    await act(async () => root.render(React.createElement(Modal, props)));
    const save = [...document.querySelectorAll("button")].find((button) => button.textContent === label);
    expect(save.disabled).toBe(false);
    await act(async () => save.click());
    expect(onSave).toHaveBeenCalledOnce();
    await act(async () => root.unmount()); root = null; host.remove(); host = null;
  }
  expect(values[1]).toEqual(values[0]);
});

it.each(["apiKey", "customModel"])("preserves %s submit values with the switch on and off", async (kind) => {
  const { default: Modal } = await (kind === "apiKey" ? AddApiKeyModalModule : AddCustomModelModalModule);
  const calls = []; const payloads = [];
  vi.stubGlobal("fetch", vi.fn(async (url, options) => { calls.push({ url, method: options.method, body: JSON.parse(options.body) }); return { ok: true, json: async () => ({ valid: true }) }; }));
  vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function () { this.setAttribute("open", ""); });
  vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function () { this.removeAttribute("open"); });
  for (const v5 of [false, true]) {
    if (v5) document.documentElement.dataset.ui = "v5"; else delete document.documentElement.dataset.ui;
    host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
    const props = { isOpen: true, provider: "openai", providerName: "OpenAI", providerAlias: "openai", onClose: vi.fn(), onSave: async (data) => { payloads.push(data); } };
    await act(async () => root.render(React.createElement(Modal, props)));
    const input = kind === "apiKey" ? document.querySelector('input[type="password"]') : document.querySelector('#custom-model-id');
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, kind === "apiKey" ? "sk-example" : "example-model"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    const submit = [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === (kind === "apiKey" ? "Save" : "Add Model"));
    expect(submit?.disabled).toBe(false);
    await act(async () => submit.click());
    await act(async () => root.unmount()); root = null; host.remove(); host = null;
  }
  expect(payloads).toHaveLength(2);
  expect(payloads[1]).toEqual(payloads[0]);
  if (kind === "apiKey") { expect(calls).toHaveLength(2); expect(calls[1]).toEqual(calls[0]); }
  vi.unstubAllGlobals();
});

it("keeps cookie import pairing and submission requests identical", async () => {
  const { default: Modal } = await CookieImportModalModule;
  const calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url, options) => {
    calls.push({ url, method: options.method, body: JSON.parse(options.body) });
    return { ok: true, json: async () => url.endsWith("pairing") ? { pairing: { header: "X-Pairing", token: "fixture" } } : { connection: { name: "Example" } } };
  }));
  vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function () { this.setAttribute("open", ""); });
  vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function () { this.removeAttribute("open"); });
  for (const v5 of [false, true]) {
    if (v5) document.documentElement.dataset.ui = "v5"; else delete document.documentElement.dataset.ui;
    host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
    await act(async () => root.render(React.createElement(Modal, { isOpen: true, provider: "tiny", importContract: { origin: "https://example.com", cookieNames: [], localStorageKeys: ["token"] }, onClose: vi.fn() })));
    const inputs = [...document.querySelectorAll("input")];
    for (const [input, value] of [[inputs[0], "Example"], [inputs[1], "credential"]]) await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
    const submit = [...document.querySelectorAll("button")].find((button) => button.textContent === "Import session");
    expect(submit.disabled).toBe(false);
    await act(async () => submit.click());
    await act(async () => root.unmount()); root = null; host.remove(); host = null;
  }
  expect(calls).toHaveLength(4);
  expect(calls.slice(2)).toEqual(calls.slice(0, 2));
  expect(calls[1]).toMatchObject({ url: "/api/providers/cookie-import", method: "POST", body: { provider: "tiny", name: "Example", origin: "https://example.com", localStorage: { token: "credential" } } });
  vi.unstubAllGlobals();
});

it("masks V5 cookie and local storage credentials", async () => {
  const { default: Modal } = await CookieImportModalModule;
  document.documentElement.dataset.ui = "v5";
  vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function () { this.setAttribute("open", ""); });
  vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function () { this.removeAttribute("open"); });
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  await act(async () => root.render(React.createElement(Modal, { isOpen: true, provider: "tiny", importContract: { origin: "https://example.com", cookieNames: [], localStorageKeys: ["token"] }, onClose: vi.fn() })));
  expect(document.querySelector('input[type="password"]')).toBeTruthy();
  vi.stubGlobal("CSS", { supports: () => false });
  await act(async () => root.render(React.createElement(Modal, { isOpen: true, provider: "grok-web", importContract: { origin: "https://example.com", cookieNames: ["sso"] }, onClose: vi.fn() })));
  expect(document.querySelector("textarea").style.color).toBe("transparent");
  expect(document.querySelector("textarea").className).toContain("selection:text-transparent");
});

it("keeps provider page API key, custom model, and rule writes identical across the switch", async () => {
  const { default: Page } = await ProviderPageModule;
  const writes = [];
  vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
    const path = String(url);
    if (((path === "/api/providers" || path === "/api/models/custom") && options.method === "POST") || (path === "/api/settings" && options.method === "PATCH")) writes.push({ url: path, method: options.method, body: JSON.parse(options.body) });
    let body = {};
    if (path === "/api/providers" && !options.method) body = { connections: [] };
    else if (path === "/api/provider-nodes") body = { nodes: [] };
    else if (path.startsWith("/api/proxy-pools")) body = { proxyPools: [] };
    else if (path === "/api/providers/validate") body = { valid: true };
    else if (path.startsWith("/api/models/auto-sync")) body = { eligible: false, providers: {} };
    else if (path.startsWith("/api/models/")) body = { ids: [], aliases: {}, models: [] };
    return { ok: true, status: 200, json: async () => body };
  }));
  vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function () { this.setAttribute("open", ""); });
  vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function () { this.removeAttribute("open"); });
  for (const v5 of [false, true]) {
    if (v5) document.documentElement.dataset.ui = "v5"; else delete document.documentElement.dataset.ui;
    host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
    await act(async () => { root.render(React.createElement(Page)); await new Promise((resolve) => setTimeout(resolve, 50)); });
    for (let i = 0; i < 5; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    const add = [...host.querySelectorAll("button")].find((button) => button.textContent.includes("Add Connection"));
    expect(add).toBeTruthy();
    await act(async () => add.click());
    const input = document.querySelector('dialog input[type="password"]');
    expect(input).toBeTruthy();
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "sk-example"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    const save = [...document.querySelectorAll("dialog button")].find((button) => button.textContent.trim() === "Save");
    await act(async () => save.click());
    const addModel = [...host.querySelectorAll("button")].find((button) => button.textContent.includes("Add Model"));
    expect(addModel).toBeTruthy();
    await act(async () => addModel.click());
    const modelId = document.querySelector("#custom-model-id");
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(modelId, "example-model"); modelId.dispatchEvent(new Event("input", { bubbles: true })); });
    const submitModel = [...document.querySelectorAll("dialog button")].find((button) => button.textContent.trim() === "Add Model");
    await act(async () => submitModel.click());
    const rules = [...host.querySelectorAll("button")].find((button) => button.textContent.includes("Error Rules"));
    await act(async () => rules.click());
    const saveRules = [...document.querySelectorAll("dialog button")].find((button) => button.textContent.trim() === "Save");
    await act(async () => saveRules.click());
    await act(async () => root.unmount()); root = null; host.remove(); host = null;
  }
  expect(writes).toHaveLength(6);
  expect(writes.slice(3)).toEqual(writes.slice(0, 3));
  expect(writes[0]).toMatchObject({ url: "/api/providers", method: "POST", body: { provider: "openrouter", apiKey: "sk-example" } });
  expect(writes[1]).toMatchObject({ url: "/api/models/custom", method: "POST", body: { id: "example-model", type: "llm" } });
  expect(writes[2]).toEqual({ url: "/api/settings", method: "PATCH", body: { providerErrorRules: {} } });
});

it("keeps connection edit and bulk review writes identical across the switch", async () => {
  const { default: Page } = await ProviderPageModule;
  const writes = [];
  const connection = { id: "c1", provider: "openrouter", name: "Example", authType: "apikey", priority: 1, isActive: true, providerSpecificData: {} };
  vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
    const path = String(url);
    if (path === "/api/providers/c1" && options.method === "PUT") writes.push({ url: path, method: options.method, body: JSON.parse(options.body) });
    let body = {};
    if (path === "/api/providers" && !options.method) body = { connections: [connection] };
    else if (path === "/api/providers/c1") body = { connection };
    else if (path === "/api/provider-nodes") body = { nodes: [] };
    else if (path.startsWith("/api/proxy-pools")) body = { proxyPools: [] };
    else if (path.startsWith("/api/models/auto-sync")) body = { eligible: false, providers: {} };
    else if (path.startsWith("/api/models/")) body = { ids: [], aliases: {}, models: [] };
    return { ok: true, status: 200, json: async () => body };
  }));
  vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function () { this.setAttribute("open", ""); });
  vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function () { this.removeAttribute("open"); });
  for (const v5 of [false, true]) {
    if (v5) document.documentElement.dataset.ui = "v5"; else delete document.documentElement.dataset.ui;
    host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
    await act(async () => { root.render(React.createElement(Page)); await new Promise((resolve) => setTimeout(resolve, 50)); });
    for (let i = 0; i < 5; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    const edit = [...host.querySelectorAll("button")].find((button) => button.textContent.trim().endsWith("Edit"));
    expect(edit).toBeTruthy();
    await act(async () => edit.click());
    const save = [...document.querySelectorAll("dialog button")].find((button) => button.textContent.trim() === "Save");
    await act(async () => save.click());
    const checkbox = host.querySelector('input[aria-label="Select Example"]');
    await act(async () => checkbox.click());
    const off = [...host.querySelectorAll("button")].find((button) => button.textContent.includes("Off Selected"));
    expect(off?.disabled).toBe(false);
    await act(async () => off.click());
    const confirm = [...document.querySelectorAll("dialog button")].find((button) => button.textContent.trim() === "Confirm");
    await act(async () => confirm.click());
    await act(async () => root.unmount()); root = null; host.remove(); host = null;
  }
  expect(writes).toHaveLength(4);
  expect(writes.slice(2)).toEqual(writes.slice(0, 2));
  expect(writes[0]).toMatchObject({ url: "/api/providers/c1", method: "PUT", body: { name: "Example", priority: 1 } });
  expect(writes[1]).toEqual({ url: "/api/providers/c1", method: "PUT", body: { isActive: false } });
});

it("keeps compatible node edits identical across the switch", async () => {
  const { default: Page } = await ProviderPageModule;
  route.id = "openai-compatible-acme";
  const node = { id: route.id, name: "Example", prefix: "example", type: "openai-compatible", apiType: "chat", baseUrl: "https://example.com/v1" };
  const writes = [];
  vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
    const path = String(url);
    if (path === `/api/provider-nodes/${node.id}` && options.method === "PUT") writes.push({ url: path, method: options.method, body: JSON.parse(options.body) });
    let body = {};
    if (path === "/api/providers") body = { connections: [] };
    else if (path === "/api/provider-nodes") body = { nodes: [node] };
    else if (path === `/api/provider-nodes/${node.id}`) body = { node };
    else if (path.startsWith("/api/proxy-pools")) body = { proxyPools: [] };
    else if (path.startsWith("/api/models/auto-sync")) body = { eligible: false, providers: {} };
    else if (path.startsWith("/api/models/")) body = { ids: [], aliases: {}, models: [] };
    return { ok: true, status: 200, json: async () => body };
  }));
  vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function () { this.setAttribute("open", ""); });
  vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function () { this.removeAttribute("open"); });
  for (const v5 of [false, true]) {
    if (v5) document.documentElement.dataset.ui = "v5"; else delete document.documentElement.dataset.ui;
    host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
    await act(async () => { root.render(React.createElement(Page)); await new Promise((resolve) => setTimeout(resolve, 50)); });
    for (let i = 0; i < 5; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    const edit = [...host.querySelectorAll("button")].find((button) => button.textContent.trim().endsWith("Edit"));
    expect(edit).toBeTruthy();
    await act(async () => edit.click());
    const save = [...document.querySelectorAll("dialog button")].find((button) => button.textContent.trim() === "Save");
    expect(save).toBeTruthy();
    await act(async () => save.click());
    await act(async () => root.unmount()); root = null; host.remove(); host = null;
  }
  expect(writes).toHaveLength(2);
  expect(writes[1]).toEqual(writes[0]);
  expect(writes[0]).toMatchObject({ url: `/api/provider-nodes/${node.id}`, method: "PUT", body: { name: "Example", prefix: "example", baseUrl: "https://example.com/v1", apiType: "chat" } });
});
