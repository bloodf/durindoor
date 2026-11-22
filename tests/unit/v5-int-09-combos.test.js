// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CombosPage from "../../src/app/(dashboard)/dashboard/combos/page.js";

const ok = (body = {}) => ({ ok: true, json: async () => body });
const failure = (error) => ({ ok: false, status: 503, json: async () => ({ error }) });
const combo = { id: "one", name: "primary", models: ["openai/a"], allowedConnectionIds: ["conn"] };
let host, root;
const flush = () => new Promise((resolve) => setTimeout(resolve, 40));
const click = async (el) => { expect(el).toBeTruthy(); await act(async () => { el.click(); await flush(); }); };
const button = (name) => [...document.querySelectorAll("button")].find((el) => el.textContent.includes(name));
const render = async () => { await act(async () => { root.render(React.createElement(CombosPage)); await flush(); }); };
function mockFetch({ reject = false, empty = false } = {}) {
  return vi.fn(async (url, options) => {
    if (options?.method === "PUT" && reject) return failure("Rejected");
    if (url === "/api/combos") return ok({ combos: empty ? [] : [combo] });
    if (url === "/api/providers") return ok({ connections: [{ id: "conn", provider: "openai", name: "Account", isActive: true }] });
    if (url === "/api/connection-groups") return ok({ groups: [] });
    if (url === "/api/usage/combos") return ok({ rows: [] });
    return ok();
  });
}
beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); delete document.documentElement.dataset.ui; vi.unstubAllGlobals(); });

describe.each([false, true])("combos V5 %s", (v5) => {
  beforeEach(() => { if (v5) document.documentElement.dataset.ui = "v5"; });
  it("sends the same strategy PATCH", async () => {
    vi.stubGlobal("fetch", mockFetch()); await render();
    await click(host.querySelector('[aria-label="Strategy for primary"]'));
    await click([...document.querySelectorAll('[role="option"]')].find((el) => el.textContent.includes("Round Robin")));
    const write = fetch.mock.calls.find(([, options]) => options?.method === "PATCH");
    expect(write[0]).toBe("/api/settings");
    expect(JSON.parse(write[1].body)).toEqual({ comboStrategies: { primary: { fallbackStrategy: "round-robin" } } });
  });
  it("sends the same create request", async () => {
    vi.stubGlobal("fetch", mockFetch()); await render();
    await click(button("Create Combo"));
    const input = document.querySelector('input[placeholder="my-combo"]');
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "new-combo"); input.dispatchEvent(new Event("input", { bubbles: true })); await flush(); });
    await click([...document.querySelectorAll("button")].find((el) => el.textContent.trim() === "Create"));
    const write = fetch.mock.calls.find(([, options]) => options?.method === "POST");
    expect(write[0]).toBe("/api/combos");
    expect(JSON.parse(write[1].body)).toEqual({ name: "new-combo", models: [], members: [], capabilities: {} });
  });
  it("renders the empty inventory", async () => {
    vi.stubGlobal("fetch", mockFetch({ empty: true })); await render();
    expect(host.textContent).toContain("No combos yet");
  });
});

describe("V5 retained drafts", () => {
  beforeEach(() => { document.documentElement.dataset.ui = "v5"; });
  it("does not write a blank timeout and sends seconds as milliseconds", async () => {
    vi.stubGlobal("fetch", mockFetch()); await render();
    const input = host.querySelector('[aria-label="Timeout for primary"]');
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, ""); input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("focusout", { bubbles: true })); await flush(); });
    expect(fetch.mock.calls.filter(([, options]) => options?.method === "PATCH")).toHaveLength(0);
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "12"); input.dispatchEvent(new Event("input", { bubbles: true })); await flush(); input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); await flush(); });
    const write = fetch.mock.calls.find(([, options]) => options?.method === "PATCH");
    expect(JSON.parse(write[1].body)).toEqual({ comboStrategies: { primary: { timeoutMs: 12000 } } });
  });
  it("retains a rejected clear and retries the same allow-list", async () => {
    vi.stubGlobal("fetch", mockFetch({ reject: true })); await render();
    await click(button("Clear (unrestrict)"));
    expect(host.textContent).toContain("Your change is retained for retry");
    await click(button("Retry"));
    const writes = fetch.mock.calls.filter(([, options]) => options?.method === "PUT");
    expect(writes).toHaveLength(2);
    expect(writes.map(([url, options]) => [url, JSON.parse(options.body)])).toEqual([["/api/combos/one", { allowedConnectionIds: [] }], ["/api/combos/one", { allowedConnectionIds: [] }]]);
  });
});

describe("V5 strategy queue", () => {
  it("preserves a second row's edit while the first save is pending", async () => {
    document.documentElement.dataset.ui = "v5";
    let release;
    const writes = [];
    const fallback = mockFetch();
    vi.stubGlobal("fetch", vi.fn(async (url, options) => {
      if (url === "/api/combos") return ok({ combos: [combo, { ...combo, id: "two", name: "secondary" }] });
      if (options?.method === "PATCH") {
        writes.push(JSON.parse(options.body));
        if (writes.length === 1) await new Promise((resolve) => { release = resolve; });
        return ok();
      }
      return fallback(url, options);
    }));
    await render();
    const change = async (name, value) => {
      const input = host.querySelector(`[aria-label="Timeout for ${name}"]`);
      await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); await flush(); input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); await flush(); });
    };
    await change("primary", "12");
    await change("secondary", "7");
    expect(writes).toHaveLength(1);
    await act(async () => { release(); await flush(); });
    expect(writes[1]).toEqual({ comboStrategies: { primary: { timeoutMs: 12000 }, secondary: { timeoutMs: 7000 } } });
  });
});

it("keeps member controls accessible and invalid weights editable", async () => {
  document.documentElement.dataset.ui = "v5";
  vi.stubGlobal("fetch", mockFetch()); await render();
  await click(host.querySelector('button[aria-label="Edit"]'));
  const dialog = document.querySelector('dialog[open]');
  expect(dialog.querySelector('button[aria-label="Drag to reorder openai/a"]')).toBeTruthy();
  expect(dialog.querySelector('button[aria-label="Remove"]')).toBeTruthy();
  expect(dialog.querySelector('input[aria-label="Disable vision"]')).toBeTruthy();
  const weight = dialog.querySelector('input[aria-label="Weight"]');
  await act(async () => { weight.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(weight, ""); weight.dispatchEvent(new Event("input", { bubbles: true })); await flush(); });
  expect(document.activeElement).toBe(weight);
  expect(dialog.textContent).toContain("positive weight");
});
