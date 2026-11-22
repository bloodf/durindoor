// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({ default: ({ href, children, ...props }) => React.createElement("a", { href, ...props }, children) }));
vi.mock("next/image", () => ({ default: ({ alt = "", src }) => React.createElement("img", { alt, src }) }));

import ProxyPoolsPage from "../../src/app/(dashboard)/dashboard/proxy-pools/page.js";
import MitmServerCard from "../../src/app/(dashboard)/dashboard/cli-tools/components/MitmServerCard.js";
import CLIToolsPageClient from "../../src/app/(dashboard)/dashboard/cli-tools/CLIToolsPageClient.js";
import ToolDetailClient from "../../src/app/(dashboard)/dashboard/cli-tools/[toolId]/ToolDetailClient.js";
import AutoConfigureClient from "../../src/app/(dashboard)/dashboard/auto-configure/AutoConfigureClient.js";
import { useNotificationStore } from "../../src/store/notificationStore.js";

const json = (body, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => body });
const flush = () => new Promise((resolve) => setTimeout(resolve, 30));
const pool = { id: "pool-1", name: "Office relay", proxyUrl: "http://proxy.example:8080", noProxy: "", isActive: true, testStatus: "active", boundConnectionCount: 0 };
const statusPreview = { wouldChange: true, services: { firecrawl: { installed: false, wouldChange: true, actions: ["$ npm install firecrawl"] } }, actions: ["$ npm install firecrawl"] };

let host;
let root;
const button = (name) => [...host.querySelectorAll("button")].find((node) => node.textContent.includes(name));
const setValue = async (node, value) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(node, value);
  node.dispatchEvent(new Event("input", { bubbles: true }));
  await flush();
});

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  useNotificationStore.getState().clearAll();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.documentElement.removeAttribute("data-ui");
  useNotificationStore.getState().clearAll();
  vi.unstubAllGlobals();
});

async function render(Component, props, v5) {
  if (v5) document.documentElement.dataset.ui = "v5";
  else document.documentElement.removeAttribute("data-ui");
  await act(async () => { root.render(React.createElement(Component, props)); await flush(); await flush(); });
}

describe("proxy pools", () => {
  it("blocks a duplicate create and keeps the list when create fails", async () => {
    const calls = [];
    vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
      calls.push([url, options.method || "GET", options.body]);
      if (options.method === "POST") return json({ error: "Proxy endpoint rejected" }, false);
      return json({ proxyPools: [pool] });
    }));
    await render(ProxyPoolsPage, {}, true);
    expect(host.querySelector('[role="region"][aria-label="Proxy pools"]')).toBeTruthy();
    expect(host.textContent).toContain("Office relay");
    await act(async () => { button("Add proxy pool").click(); await flush(); });
    const dialog = host.querySelector("dialog") || document.body.querySelector("dialog");
    const fields = [...dialog.querySelectorAll("input")];
    await setValue(fields[0], "Backup relay");
    await setValue(fields[1], "http://backup.example:8080");
    const save = [...dialog.querySelectorAll("button")].find((node) => node.textContent.includes("Save"));
    await act(async () => { save.click(); save.click(); await flush(); });
    const posts = calls.filter(([, method]) => method === "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0][0]).toBe("/api/proxy-pools");
    expect(JSON.parse(posts[0][2])).toMatchObject({ name: "Backup relay", proxyUrl: "http://backup.example:8080", isActive: true, strictProxy: false });
    expect(host.textContent).toContain("Office relay");
    expect(useNotificationStore.getState().notifications.some((entry) => entry.type === "error" && entry.message === "Proxy endpoint rejected")).toBe(true);
  });

  it("blocks a duplicate delete and keeps the pool when delete fails", async () => {
    const calls = [];
    vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
      calls.push([url, options.method || "GET"]);
      if (options.method === "DELETE") return json({ error: "Cannot delete right now" }, false);
      return json({ proxyPools: [pool] });
    }));
    await render(ProxyPoolsPage, {}, false);
    await act(async () => { host.querySelector('[aria-label="Delete Office relay"]').click(); await flush(); });
    const confirm = [...document.body.querySelectorAll("button")].find((node) => node.textContent.includes("Delete proxy pool"));
    await act(async () => { confirm.click(); confirm.click(); await flush(); });
    expect(calls.filter(([, method]) => method === "DELETE")).toHaveLength(1);
    expect(host.textContent).toContain("Office relay");
  });

  it("retries a failed load and then shows the pools", async () => {
    let failed = true;
    vi.stubGlobal("fetch", vi.fn(async () => {
      if (failed) throw new Error("Connection interrupted");
      return json({ proxyPools: [pool] });
    }));
    await render(ProxyPoolsPage, {}, true);
    expect(host.querySelector('[role="alert"]').textContent).toMatch(/could not be loaded/i);
    failed = false;
    await act(async () => { button("Retry").click(); await flush(); await flush(); });
    expect(host.textContent).toContain("Office relay");
  });
});

describe.each([false, true])("network client request parity V5=%s", (v5) => {
  it("sends the same certificate trust request", async () => {
    const calls = [];
    vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
      calls.push([url, options.method || "GET", options.body ?? undefined]);
      if ((options.method || "GET") === "GET") return json({ running: false, certExists: true, certTrusted: false, dnsStatus: {}, hasCachedPassword: true, needsSudoPassword: false, isWin: false });
      return json({ running: false, certExists: true, certTrusted: true });
    }));
    await render(MitmServerCard, { apiKeys: [], cloudEnabled: false }, v5);
    await act(async () => { button("Trust Cert").click(); await flush(); });
    if (v5) {
      const dialog = document.body.querySelector("dialog");
      expect(dialog.contains(document.activeElement)).toBe(true);
      const confirm = [...dialog.querySelectorAll("button")].find((node) => node.textContent.includes("Trust Cert"));
      await act(async () => { confirm.click(); await flush(); });
    }
    const trust = calls.filter(([, method]) => method === "PATCH");
    expect(trust).toEqual([["/api/cli-tools/antigravity-mitm", "PATCH", JSON.stringify({ action: "trust-cert", sudoPassword: "" })]]);
  });

  it("posts the same auto-configure body and keeps the preview after a failure", async () => {
    const calls = [];
    vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
      calls.push([url, options.method || "GET", options.body]);
      return json({ error: "Configuration service unavailable" }, false);
    }));
    await render(AutoConfigureClient, { status: statusPreview }, v5);
    if (v5) {
      const announced = host.querySelector('[role="status"]');
      expect(announced.textContent).toContain("$ npm install firecrawl");
      expect(announced.compareDocumentPosition(button("Run auto-configure")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    await act(async () => { button("Run auto-configure").click(); button("Run auto-configure").click(); await flush(); });
    expect(calls.filter(([, method]) => method === "POST")).toEqual([["/api/settings/auto-configure", "POST", JSON.stringify({ dryRun: false })]]);
    expect(host.textContent).toContain("$ npm install firecrawl");
    expect(host.textContent).toContain("Configuration service unavailable");
  });
});

it("retries the CLI catalog fetch and keeps catalog links reachable", async () => {
  let calls = 0;
  vi.stubGlobal("fetch", vi.fn(async () => {
    calls += 1;
    if (calls === 1) return json({ error: "upstream" }, false);
    return json({ claude: { installed: true, has9Router: true } });
  }));
  document.documentElement.dataset.ui = "v5";
  await render(CLIToolsPageClient, { machineId: "machine" }, true);
  const alert = host.querySelector('[role="alert"]');
  expect(alert.textContent).toMatch(/could not load tool statuses/i);
  await act(async () => { button("Retry").click(); await flush(); await flush(); });
  expect(calls).toBe(2);
  const links = [...host.querySelectorAll('a[href^="/dashboard/cli-tools/"]')];
  expect(links.length).toBeGreaterThan(0);
  for (const link of links) expect(link.tabIndex).toBeGreaterThanOrEqual(0);
});

it("applies the same CLI config body and labels endpoint, model, and key controls", async () => {
  const pathOf = (url) => String(url).replace(/^https?:\/\/[^/]+/, "");
  const respond = async (url, options = {}) => {
    const path = pathOf(url);
    if (path === "/api/providers") return json({ connections: [{ id: "openai-main", provider: "openai", name: "OpenAI", isActive: true, testStatus: "active", defaultModel: "gpt-4.1" }] });
    if (path === "/api/settings") return json({ cloudEnabled: false, ccFilterNaming: false });
    if (path === "/api/tunnel/status") return json({ tunnel: { enabled: false, publicUrl: "" }, tailscale: { enabled: false, tunnelUrl: "" } });
    if (path === "/api/keys") return json({ keys: [] });
    if (path === "/api/models/alias") return json({ aliases: {} });
    if (path === "/api/cli-tools/claude-settings" && (options.method || "GET") === "GET") return json({ installed: true, has9Router: false, settings: { env: {} } });
    if (options.method === "POST") return json({ ok: true });
    return json({});
  };
  const settle = async () => act(async () => { await flush(); await flush(); await flush(); });
  const capture = async (v5) => {
    const calls = [];
    vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => { calls.push([pathOf(url), options.method || "GET", options.body]); return respond(url, options); }));
    await render(ToolDetailClient, { toolId: "claude", machineId: "machine" }, v5);
    await settle();
    const apply = button("Apply");
    expect(apply.disabled).toBe(false);
    await act(async () => { apply.click(); await flush(); });
    const post = calls.find(([, method]) => method === "POST");
    await act(async () => root.unmount());
    root = createRoot(host);
    return post;
  };
  vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => respond(url, options)));
  await render(ToolDetailClient, { toolId: "claude", machineId: "machine" }, true);
  await settle();
  expect(host.querySelector('[aria-label="Endpoint"]')).toBeTruthy();
  expect(host.querySelector('[aria-label="API key preset"]')).toBeTruthy();
  expect(host.querySelector('[aria-label="Context window"]')).toBeTruthy();
  expect([...host.querySelectorAll("input")].some((node) => (node.getAttribute("aria-label") || "").endsWith("model"))).toBe(true);
  await act(async () => root.unmount());
  root = createRoot(host);
  expect(await capture(true)).toEqual(await capture(false));
});
