// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.hoisted(() => { vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("Network blocked")))); });
const saved = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn() }));
vi.mock("open-sse/utils/kimchiUserAgent.js", () => ({ getKimchiUserAgent: () => "offline", updateKimchiUserAgent: vi.fn() }));
vi.mock("@/lib/localDb", () => ({ getProviderConnectionById: saved.get, updateProviderConnection: saved.update }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn(async () => ({ connectionProxyEnabled: false })) }));
import { POST as testConnection } from "../../src/app/api/providers/[id]/test/route.js";
import { __setProviderTestFetchForTesting } from "../../src/app/api/providers/[id]/test/testUtils.js";

const route = vi.hoisted(() => ({ id: "openrouter" }));
vi.mock("next/navigation", () => ({ useParams: () => route, useRouter: () => ({ push: vi.fn(), back: vi.fn() }) }));
import ProviderDetailPage from "../../src/app/(dashboard)/dashboard/providers/[id]/page.js";

const ok = (data) => ({ ok: true, json: async () => data });
let host, root;
const click = async (element) => { expect(element).toBeTruthy(); await act(async () => { element.click(); }); };
const button = (text) => [...host.querySelectorAll("button")].find((node) => node.textContent.includes(text));

beforeEach(async () => {
  saved.get.mockReset();
  saved.update.mockReset();
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
afterEach(async () => { vi.useRealTimers(); await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

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

it("cancels a selected test on provider switch and ignores a late result after switching back", async () => {
  let finish;
  let firstSignal;
  const previous = fetch.getMockImplementation();
  fetch.mockImplementation((url, options) => {
    if (url === "/api/providers/a/test") {
      firstSignal = options.signal;
      return new Promise((resolve) => { finish = resolve; });
    }
    if (url === "/api/providers" && route.id === "siliconflow") return Promise.resolve(ok({ connections: [{ id: "c", provider: "siliconflow", name: "Gamma", authType: "apikey", isActive: true }] }));
    return previous(url, options);
  });
  await click(host.querySelector('[aria-label="Select Alpha"]'));
  await click(host.querySelector('[aria-label="Select Beta"]'));
  await click(button("Test Selected"));
  expect(firstSignal.aborted).toBe(false);
  route.id = "siliconflow";
  await act(async () => { root.render(React.createElement(ProviderDetailPage)); await new Promise((resolve) => setTimeout(resolve, 50)); });
  expect(firstSignal.aborted).toBe(true);
  saved.get.mockReset();
  saved.update.mockReset();
  route.id = "openrouter";
  await act(async () => { root.render(React.createElement(ProviderDetailPage)); await new Promise((resolve) => setTimeout(resolve, 50)); });
  vi.useFakeTimers();
  await act(async () => { finish(ok({ valid: true })); await Promise.resolve(); });
  await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
  expect(fetch.mock.calls.some(([url]) => url === "/api/providers/b/test")).toBe(false);
  expect(host.textContent).not.toContain("Completed:");
  expect(host.textContent).not.toContain("Passed:");
  expect(host.textContent).not.toContain("Testing Connection One-by-One");
});

it("aborts a selected test on unmount and does not schedule the next account", async () => {
  let finish;
  let signal;
  const previous = fetch.getMockImplementation();
  fetch.mockImplementation((url, options) => {
    if (url === "/api/providers/a/test") {
      signal = options.signal;
      return new Promise((resolve) => { finish = resolve; });
    }
    return previous(url, options);
  });
  await click(host.querySelector('[aria-label="Select Alpha"]'));
  await click(host.querySelector('[aria-label="Select Beta"]'));
  await click(button("Test Selected"));
  await act(async () => root.unmount());
  expect(signal.aborted).toBe(true);
  vi.useFakeTimers();
  await act(async () => { finish(ok({ valid: true })); await Promise.resolve(); });
  await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
  expect(fetch.mock.calls.some(([url]) => url === "/api/providers/b/test")).toBe(false);
  root = createRoot(host);
});

it("keeps per-account success and failure results in a selected test", async () => {
  const previous = fetch.getMockImplementation();
  fetch.mockImplementation((url, options) => url === "/api/providers/b/test"
    ? Promise.resolve(ok({ valid: false, error: "Credentials rejected" })) : previous(url, options));
  await click(host.querySelector('[aria-label="Select Alpha"]'));
  await click(host.querySelector('[aria-label="Select Beta"]'));
  vi.useFakeTimers();
  await click(button("Test Selected"));
  await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
  expect(fetch.mock.calls.some(([url]) => url === "/api/providers/a/test")).toBe(true);
  expect(fetch.mock.calls.some(([url]) => url === "/api/providers/b/test")).toBe(true);
  expect(host.textContent).toContain("Passed: 1");
  expect(host.textContent).toContain("Failed: 1");
  expect(host.textContent).toContain("failed: Credentials rejected");
});

it("prevents priority changes while filtered and reorders normally after clearing", async () => {
  const filter = host.querySelector('[aria-label="Filter connections"]');
  const setFilter = async (value) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(filter, value);
      filter.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  await setFilter("Beta");
  const up = host.querySelector('[aria-label="Move Beta up"]');
  expect(up.disabled).toBe(true);
  expect(button("Reorder").disabled).toBe(true);
  const hint = document.getElementById(filter.getAttribute("aria-describedby"));
  expect(hint?.textContent).toBe("Clear the connection filter to reorder priorities.");
  await click(up);
  await click(button("Reorder"));
  expect(fetch.mock.calls.some(([url]) => url === "/api/providers/reorder")).toBe(false);

  await setFilter("");
  expect(host.querySelector('[aria-label="Move Beta up"]').disabled).toBe(false);
  expect(button("Reorder").disabled).toBe(false);
  await click(host.querySelector('[aria-label="Move Beta up"]'));
  const [, options] = fetch.mock.calls.find(([url]) => url === "/api/providers/reorder");
  expect(JSON.parse(options.body)).toEqual({ providerId: "openrouter", orderedIds: ["b", "a"] });
  const labels = [...host.querySelectorAll('input[type="checkbox"][aria-label^="Select "]')].map((input) => input.getAttribute("aria-label"));
  expect(labels).toEqual(["Select Beta", "Select Alpha"]);
});

it("counts hidden selected-test results and lets the operator reveal them", async () => {
  const previous = fetch.getMockImplementation();
  fetch.mockImplementation((url, options) => url === "/api/providers/a/test"
    ? Promise.resolve(ok({ valid: false, error: "Credentials rejected" })) : previous(url, options));
  await click(host.querySelector('[aria-label="Select Alpha"]'));
  await click(host.querySelector('[aria-label="Select Beta"]'));
  const filter = host.querySelector('[aria-label="Filter connections"]');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(filter, "Beta");
    filter.dispatchEvent(new Event("input", { bubbles: true }));
  });
  vi.useFakeTimers();
  await click(button("Test Selected"));
  await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
  expect(host.textContent).toContain("Total: 2");
  expect(host.textContent).toContain("Completed: 2");
  expect(host.textContent).toContain("Passed: 1");
  expect(host.textContent).toContain("Failed: 1");
  expect(host.textContent).toContain("1 completed result hidden by the filter.");
  expect(filter.value).toBe("Beta");
  expect(host.textContent).toContain("2 selected");
  expect(host.querySelector('[aria-label="Select Alpha"]')).toBeNull();
  await click(button("Clear filter to view results"));
  expect(filter.value).toBe("");
  expect(host.textContent).not.toContain("result hidden by the filter");
  const alpha = host.querySelector('[aria-label="Select Alpha"]');
  const beta = host.querySelector('[aria-label="Select Beta"]');
  expect(alpha.checked).toBe(true);
  expect(beta.checked).toBe(true);
  expect(alpha.parentElement.parentElement.textContent).toContain("failed: Credentials rejected");
  expect(beta.parentElement.parentElement.textContent).toContain("success");
});

it("reports unavailable separately from invalid credentials, including hidden results", async () => {
  const previous = fetch.getMockImplementation();
  saved.get.mockImplementation(async (id) => ({ id, provider: "gitlawb-gmi", authType: "apikey", apiKey: id === "a" ? "temporary-test-secret" : "invalid-test-secret", testStatus: "active", providerSpecificData: {} }));
  // Only the outbound transport is replaced. Probe, adapter, persistence decision,
  // route serialization and the detail consumer all run their real implementation.
  const transport = vi.fn(async (_url, options) => new Response("", { status: options.headers.Authorization.includes("temporary-test-secret") ? 503 : 401 }));
  const restore = __setProviderTestFetchForTesting(transport);
  fetch.mockImplementation((url, options) => {
    if (url === "/api/providers") return Promise.resolve(ok({ connections: [
      { id: "a", provider: "gitlawb-gmi", name: "Alpha", authType: "apikey", isActive: true },
      { id: "b", provider: "gitlawb-gmi", name: "Beta", authType: "apikey", isActive: true },
    ] }));
    if (/^\/api\/providers\/[ab]\/test$/.test(String(url))) {
      const id = String(url).split("/")[3];
      return testConnection(new Request(`http://localhost${url}`, { method: "POST" }), { params: Promise.resolve({ id }) });
    }
    return previous(url, options);
  });
  try {
  route.id = "gitlawb-gmi";
  await act(async () => { root.render(React.createElement(ProviderDetailPage)); await new Promise((resolve) => setTimeout(resolve, 50)); });
  await click(host.querySelector('[aria-label="Select Alpha"]'));
  await click(host.querySelector('[aria-label="Select Beta"]'));
  const filter = host.querySelector('[aria-label="Filter connections"]');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(filter, "Beta");
    filter.dispatchEvent(new Event("input", { bubbles: true }));
  });
  vi.useFakeTimers();
  await click(button("Test Selected"));
  await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
  expect(host.textContent).toContain("Total: 2");
  expect(host.textContent).toContain("Completed: 2");
  expect(host.textContent).toContain("Passed: 0");
  expect(host.textContent).toContain("Failed: 1");
  expect(host.textContent).toContain("Unavailable: 1");
  expect(host.querySelector('[aria-label="Unavailable connection tests"]')?.textContent).toContain("Alpha: Provider unavailable - try again later");
  expect(host.textContent).toContain("1 completed result hidden by the filter.");
  expect(host.textContent).toContain("failed: Invalid API key");
  expect(host.textContent).toContain("Operational: unknown");
  expect(fetch.mock.calls.filter(([, options]) => options?.method === "PUT")).toHaveLength(0);
  expect(transport).toHaveBeenCalled();
  expect(saved.update).toHaveBeenCalledTimes(1);
  expect(saved.update).toHaveBeenCalledWith("b", expect.objectContaining({ testStatus: "error", lastError: "Invalid API key" }));
  expect(host.textContent).not.toContain("test-secret");
  expect(JSON.stringify(saved.update.mock.calls)).not.toContain("test-secret");
  } finally { restore(); }
});

it("removes a selected account from selection when its individual deletion completes", async () => {
  await click(host.querySelector('[aria-label="Select Alpha"]'));
  await click(host.querySelector('[aria-label="Select Beta"]'));
  await click([...host.querySelectorAll("span")].find((node) => node.textContent === "Delete")?.closest("button"));
  await click([...document.querySelectorAll("button")].find((node) => node.textContent.trim() === "Confirm"));
  expect(host.querySelector('[aria-label="Select Alpha"]')).toBeNull();
  expect(host.querySelector('[aria-label="Select Beta"]').checked).toBe(true);
  expect(host.textContent).toContain("1 selected");
  expect(host.textContent).not.toContain("2 selected");
});
