// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.hoisted(() => { vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("Network blocked")))); });
const route = vi.hoisted(() => ({ id: "openrouter" }));
vi.mock("next/navigation", () => ({ useParams: () => route, useRouter: () => ({ push: vi.fn(), back: vi.fn() }) }));
import ProviderDetailPage from "../../src/app/(dashboard)/dashboard/providers/[id]/page.js";

const ok = (data) => ({ ok: true, json: async () => data });
let host, root;
const click = async (element) => { expect(element).toBeTruthy(); await act(async () => { element.click(); }); };
const button = (text) => [...host.querySelectorAll("button")].find((node) => node.textContent.includes(text));

beforeEach(async () => {
  route.id = "openrouter";
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("alert", vi.fn());
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  vi.stubGlobal("fetch", vi.fn(async (url, options) => {
    const path = String(url);
    if (path === "/api/providers" && !options?.method) return ok({ connections: [
      { id: "a", provider: "openrouter", name: "Alpha", authType: "apikey", isActive: true },
      { id: "b", provider: "openrouter", name: "Beta", authType: "apikey", isActive: true },
    ] });
    if (path === "/api/providers/b" && options?.method === "PUT") return { ok: false, status: 500, json: async () => ({}) };
    if (path === "/api/providers/a" && options?.method === "PUT") return ok({ connection: { id: "a", provider: "openrouter", name: "Alpha", authType: "apikey", isActive: false } });
    if (path.endsWith("/test")) return ok({ valid: true });
    if (path === "/api/provider-nodes") return ok({ nodes: [] });
    if (path.startsWith("/api/proxy-pools")) return ok({ proxyPools: [{ id: "pool", name: "Pool", isActive: true }] });
    if (path.startsWith("/api/models/auto-sync")) return ok({ providers: {} });
    if (path.startsWith("/api/models/custom")) return ok({ models: [] });
    if (path.startsWith("/api/models/alias")) return ok({ aliases: {} });
    return ok({});
  }));
  await act(async () => { root.render(React.createElement(ProviderDetailPage)); await new Promise((resolve) => setTimeout(resolve, 50)); });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it("keeps selection across filtering and tests only the selected accounts", async () => {
  await click(host.querySelector('[aria-label="Select Alpha"]'));
  const filter = host.querySelector('[aria-label="Filter connections"]');
  expect(filter).toBeTruthy();
  await act(async () => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; setter.call(filter, "Beta"); filter.dispatchEvent(new Event("input", { bubbles: true })); });
  expect(host.querySelector('[aria-label="Select Alpha"]')).toBeNull();
  expect(host.textContent).toContain("1 selected");
  expect(host.querySelector("details")?.textContent).toContain("Alpha (a)");
  await click(host.querySelector('label input[type="checkbox"]'));
  expect(host.textContent).toContain("2 selected");
  await click(host.querySelector('label input[type="checkbox"]'));
  expect(host.textContent).toContain("1 selected");
  await click(button("Test Selected"));
  expect(fetch.mock.calls.some(([url]) => url === "/api/providers/a/test")).toBe(true);
  expect(fetch.mock.calls.some(([url]) => url === "/api/providers/b/test")).toBe(false);
});

it("identifies each account whose bulk status update failed", async () => {
  await click(host.querySelector('[aria-label="Select Alpha"]'));
  await click(host.querySelector('[aria-label="Select Beta"]'));
  await click(button("Off Selected"));
  expect(host.textContent).toContain("Beta");
  expect(host.textContent).toContain("HTTP 500");
});

it("requires confirmation before deleting and identifies the failed account", async () => {
  fetch.mockImplementation(async (url, options) => {
    const path = String(url);
    if (path === "/api/providers/a" && options?.method === "DELETE") return ok({});
    if (path === "/api/providers/b" && options?.method === "DELETE") return { ok: false, status: 409, json: async () => ({ error: "Cannot delete scoped account" }) };
    if (path === "/api/providers") return ok({ connections: [
      { id: "a", provider: "openrouter", name: "Alpha", authType: "apikey", isActive: true },
      { id: "b", provider: "openrouter", name: "Beta", authType: "apikey", isActive: true },
    ] });
    return ok({});
  });
  await click(host.querySelector('[aria-label="Select Alpha"]'));
  await click(host.querySelector('[aria-label="Select Beta"]'));
  await click(button("Delete Selected"));
  expect(fetch.mock.calls.filter(([, options]) => options?.method === "DELETE")).toHaveLength(0);
  await click([...document.querySelectorAll("button")].find((node) => node.textContent.trim() === "Confirm"));
  expect(fetch.mock.calls.filter(([, options]) => options?.method === "DELETE")).toHaveLength(2);
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Beta (b): Cannot delete scoped account");
  expect(host.querySelector('[aria-label="Select Beta"]').checked).toBe(true);
});


it("reports which accounts failed the all-account proxy assignment", async () => {
  await click(button("Apply Proxy"));
  await click([...document.querySelectorAll("button")].find((node) => node.textContent.includes("None (unbind all)")));
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Beta (b): HTTP 500");
  expect(fetch.mock.calls.filter(([url, options]) => String(url).startsWith("/api/providers/") && options?.method === "PUT")).toHaveLength(2);
});


it("does not restore old-provider selections after a pending status update", async () => {
  let finish;
  const previous = fetch.getMockImplementation();
  fetch.mockImplementation((url, options) => {
    if (url === "/api/providers/a" && options?.method === "PUT") return new Promise((resolve) => { finish = resolve; });
    if (url === "/api/providers" && route.id === "siliconflow") return Promise.resolve(ok({ connections: [{ id: "c", provider: "siliconflow", name: "Gamma", authType: "apikey", isActive: true }] }));
    return previous(url, options);
  });
  await click(host.querySelector('[aria-label="Select Alpha"]'));
  await click(button("Off Selected"));
  route.id = "siliconflow";
  await act(async () => { root.render(React.createElement(ProviderDetailPage)); await new Promise((resolve) => setTimeout(resolve, 50)); });
  await act(async () => { finish({ ok: false, status: 500 }); await Promise.resolve(); });
  await click(host.querySelector('[aria-label="Select Gamma"]'));
  expect(host.textContent).toContain("1 selected");
  expect(host.textContent).not.toContain("2 selected");
});

it("preserves selection changes made during a pending status update", async () => {
  let finish;
  const previous = fetch.getMockImplementation();
  fetch.mockImplementation((url, options) => url === "/api/providers/a" && options?.method === "PUT"
    ? new Promise((resolve) => { finish = resolve; }) : previous(url, options));
  await click(host.querySelector('[aria-label="Select Alpha"]'));
  await click(button("Off Selected"));
  await click(host.querySelector('[aria-label="Select Beta"]'));
  await act(async () => { finish({ ok: false, status: 500 }); await Promise.resolve(); });
  expect(host.textContent).toContain("2 selected");
});

it("does not restore failed deletions after switching providers", async () => {
  let finish;
  const previous = fetch.getMockImplementation();
  fetch.mockImplementation((url, options) => {
    if (url === "/api/providers/a" && options?.method === "DELETE") return new Promise((resolve) => { finish = resolve; });
    if (url === "/api/providers" && route.id === "siliconflow") return Promise.resolve(ok({ connections: [{ id: "c", provider: "siliconflow", name: "Gamma", authType: "apikey", isActive: true }] }));
    return previous(url, options);
  });
  await click(host.querySelector('[aria-label="Select Alpha"]'));
  await click(button("Delete Selected"));
  await click([...document.querySelectorAll("button")].find((node) => node.textContent.trim() === "Confirm"));
  route.id = "siliconflow";
  await act(async () => { root.render(React.createElement(ProviderDetailPage)); await new Promise((resolve) => setTimeout(resolve, 50)); });
  await act(async () => { finish({ ok: false, status: 409, json: async () => ({ error: "Cannot delete scoped account" }) }); await Promise.resolve(); });
  await click(host.querySelector('[aria-label="Select Gamma"]'));
  expect(host.textContent).not.toContain("2 selected");
  expect(host.querySelector('[role="alert"]')).toBeNull();
});

it("stops applying proxy assignments after switching providers", async () => {
  let finish;
  const previous = fetch.getMockImplementation();
  fetch.mockImplementation((url, options) => {
    if (url === "/api/providers/a" && options?.method === "PUT") return new Promise((resolve) => { finish = resolve; });
    if (url === "/api/providers" && route.id === "siliconflow") return Promise.resolve(ok({ connections: [{ id: "c", provider: "siliconflow", name: "Gamma", authType: "apikey", isActive: true }] }));
    return previous(url, options);
  });
  await click(button("Apply Proxy"));
  await click([...document.querySelectorAll("button")].find((node) => node.textContent.includes("None (unbind all)")));
  route.id = "siliconflow";
  await act(async () => { root.render(React.createElement(ProviderDetailPage)); await new Promise((resolve) => setTimeout(resolve, 50)); });
  await act(async () => { finish({ ok: false, status: 500 }); await Promise.resolve(); });
  expect(fetch.mock.calls.some(([url, options]) => url === "/api/providers/b" && options?.method === "PUT")).toBe(false);
  expect(host.querySelector('[role="alert"]')).toBeNull();
});
