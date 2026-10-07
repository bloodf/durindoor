// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { notify } = vi.hoisted(() => ({ notify: vi.fn() }));
vi.mock("@/store/notificationStore", () => ({
  useNotificationStore: (selector) => selector({ addNotification: notify })
}));
vi.mock("@/shared/hooks/useCopyToClipboard", () => ({
  useCopyToClipboard: () => ({ copied: null, copy: vi.fn() })
}));
import McpGatewayPage from "@/app/(dashboard)/dashboard/mcp-gateway/page.js";
import McpGatewayErrorView from "@/app/(dashboard)/dashboard/mcp-gateway/McpGatewayErrorView.jsx";
import { InstanceEditModal } from "@/app/(dashboard)/dashboard/mcp-gateway/McpGatewayComponents.jsx";
import { fireEvent, within } from "@testing-library/dom";
function mockJsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}
function makeFetchMock(handlers) {
  return vi.fn(async (url, init = {}) => {
    const method = (init.method || "GET").toUpperCase();
    for (const handler of handlers) {
      const result = handler(method, url, init);
      if (result) return result;
    }
    return mockJsonResponse({ error: "no handler" }, 404);
  });
}
async function flush(ms = 5) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}
describe("MCP Gateway production UI", () => {
  let container;
  let root;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    root.unmount();
    container.remove();
    vi.restoreAllMocks();
  });
  it("renders the instances page header and its actions", async () => {
    globalThis.fetch = makeFetchMock([
      (method, url) => method === "GET" && url.endsWith("/api/mcp-gateway/instances") && mockJsonResponse({ instances: [] })
    ]);
    await act(async () => {
      root.render(/* @__PURE__ */ React.createElement(McpGatewayPage, null));
    });
    await flush();
    expect(container.textContent).toContain("MCP Gateway");
    expect(container.textContent).toContain("New instance");
    expect(container.textContent).toContain("No instances yet");
    // Keys moved to their own page: this one links there and never renders a
    // keys section, so a key action cannot reload the instance list.
    expect(container.textContent).toContain("Gateway keys");
    expect(container.textContent).not.toContain("No gateway keys yet");
    expect(container.querySelector('a[href="/dashboard/mcp-gateway/keys"]')).not.toBeNull();
  });

  it("does not fetch keys at all from the instances page", async () => {
    const fetch = makeFetchMock([
      (method, url) => method === "GET" && url.endsWith("/api/mcp-gateway/instances") && mockJsonResponse({ instances: [] })
    ]);
    globalThis.fetch = fetch;
    await act(async () => {
      root.render(/* @__PURE__ */ React.createElement(McpGatewayPage, null));
    });
    await flush();
    expect(fetch.mock.calls.some(([url]) => String(url).endsWith("/api/mcp-gateway/keys"))).toBe(false);
  });
  it("renders one row per instance with kind, transport, and oauth badges", async () => {
    globalThis.fetch = makeFetchMock([
      (method, url) => method === "GET" && url.endsWith("/api/mcp-gateway/instances") && mockJsonResponse({ instances: [
        { id: "g", slug: "granola", kind: "http", transport: "http", url: "https://mcp.granola.ai/mcp", oauth: true, oauthStatus: "connected", enabled: true },
        { id: "fs", slug: "fs-local", kind: "npx", transport: "stdio", command: "npx", args: ["-y", "fs"], oauth: false, enabled: false }
      ] }),
      (method, url) => method === "GET" && url.endsWith("/api/mcp-gateway/keys") && mockJsonResponse({ keys: [] })
    ]);
    await act(async () => {
      root.render(/* @__PURE__ */ React.createElement(McpGatewayPage, null));
    });
    await flush();
    expect(container.textContent).toContain("granola");
    expect(container.textContent).toContain("fs-local");
    expect(container.textContent).toContain("http");
    expect(container.textContent).toContain("stdio");
    expect(container.textContent).toContain("connected");
    expect(container.textContent).toContain("disabled");
  });
  it("renders a needs_login badge for an oauth instance awaiting login", async () => {
    globalThis.fetch = makeFetchMock([
      (method, url) => method === "GET" && url.endsWith("/api/mcp-gateway/instances") && mockJsonResponse({ instances: [
        { id: "s", slug: "stale", kind: "http", transport: "http", url: "https://legacy.invalid", oauth: true, oauthStatus: "needs_login", enabled: true }
      ] }),
      (method, url) => method === "GET" && url.endsWith("/api/mcp-gateway/keys") && mockJsonResponse({ keys: [] })
    ]);
    await act(async () => {
      root.render(/* @__PURE__ */ React.createElement(McpGatewayPage, null));
    });
    await flush();
    expect(container.textContent).toContain("needs login");
  });
  it("renders the error boundary view without suppressing production logging", async () => {
    const reset = vi.fn();
    await act(async () => {
      root.render(/* @__PURE__ */ React.createElement(McpGatewayErrorView, { reset }));
    });
    expect(container.textContent).toContain("MCP Gateway failed to load");
    expect(container.textContent).toContain("Try again");
  });
  it("applies a preset without carrying HTTP credentials into local stdio", async () => {
    const save = vi.fn();
    await act(async () => {
      root.render(/* @__PURE__ */ React.createElement(InstanceEditModal, { initial: { slug: "", headers: '{"x-trace-id":"old"}', env: '{"PRIOR_SECRET":"do-not-carry"}', providerConnectionId: "conn-old", oauth: true, enabled: false }, onClose: vi.fn(), onSave: save }));
    });
    const dialog = document.body.querySelector("dialog");
    const preset = dialog.querySelector('[aria-label="Server preset"]');
    await act(async () => { preset.click(); });
    await act(async () => { [...document.querySelectorAll('[role="option"]')].find((option) => option.textContent.includes("Context7")).click(); });
    await act(async () => { fireEvent.change(within(dialog).getByRole("textbox", { name: "Headers (JSON object)" }), { target: { value: '{"x-trace-id":"previous-server"}' } }); });
    await act(async () => { fireEvent.change(within(dialog).getByRole("textbox", { name: "Provider connection ID (optional)" }), { target: { value: "conn-previous-server" } }); });
    await act(async () => { preset.click(); });
    await act(async () => { [...document.querySelectorAll('[role="option"]')].find((option) => option.textContent.includes("Playwright")).click(); });
    expect(dialog.querySelector('input[value="npx"]')).not.toBeNull();
    expect(dialog.querySelector('input[value="{}"]')).not.toBeNull();
    expect(dialog.querySelector('input[value="https://mcp.context7.com/mcp"]')).toBeNull();
    await act(async () => { within(dialog).getByRole("button", { name: /Save$/ }).click(); });
    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0][0]).toMatchObject({ url: "", headers: "{}", env: "{}", oauth: false, enabled: false });
    expect(save.mock.calls[0][0].providerConnectionId).toBeUndefined();
  });
  it("blocks incomplete preset secrets and filesystem paths but preserves custom saves", async () => {
    const save = vi.fn();
    await act(async () => {
      root.render(/* @__PURE__ */ React.createElement(InstanceEditModal, { initial: {}, onClose: vi.fn(), onSave: save }));
    });
    const dialog = document.body.querySelector("dialog");
    const preset = dialog.querySelector('[aria-label="Server preset"]');
    await act(async () => { preset.click(); });
    await act(async () => { [...document.querySelectorAll('[role="option"]')].find((option) => option.textContent.includes("Brave Search")).click(); });
    await act(async () => { within(dialog).getByRole("button", { name: /Save$/ }).click(); });
    expect(save).not.toHaveBeenCalled();
    expect(dialog.textContent).toContain("Set BRAVE_API_KEY");
    await act(async () => { preset.click(); });
    await act(async () => { [...document.querySelectorAll('[role="option"]')].find((option) => option.textContent.includes("Filesystem")).click(); });
    await act(async () => { within(dialog).getByRole("button", { name: /Save$/ }).click(); });
    expect(save).not.toHaveBeenCalled();
    const args = within(dialog).getByRole("textbox", { name: "Args (JSON array)" });
    for (const paths of [["/"], ["/approved", "/"], ["/."], ["/tmp/.."], ["////"]]) {
      await act(async () => { fireEvent.change(args, { target: { value: JSON.stringify(["-y", "@modelcontextprotocol/server-filesystem", ...paths]) } }); });
      await act(async () => { within(dialog).getByRole("button", { name: /Save$/ }).click(); });
      expect(save).not.toHaveBeenCalled();
    }
    await act(async () => { fireEvent.change(args, { target: { value: '["-y","@modelcontextprotocol/server-filesystem","/approved"]' } }); });
    await act(async () => { preset.click(); });
    await act(async () => { [...document.querySelectorAll('[role="option"]')].find((option) => option.textContent.includes("Custom")).click(); });
    await act(async () => { within(dialog).getByRole("button", { name: /Save$/ }).click(); });
    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0][0].args).toBe('["-y","@modelcontextprotocol/server-filesystem","/approved"]');
  });
  it("leaves existing instances in custom edit mode", async () => {
    await act(async () => {
      root.render(/* @__PURE__ */ React.createElement(InstanceEditModal, { initial: { id: "existing", slug: "manual", title: "Manual", kind: "http", transport: "http", url: "https://manual.invalid/mcp", args: "[]", env: "{}", headers: "{}", oauth: false, enabled: true }, onClose: vi.fn(), onSave: vi.fn() }));
    });
    const dialog = document.body.querySelector("dialog");
    expect(dialog.querySelector('[aria-label="Server preset"]')).toBeNull();
    expect(dialog.querySelector('input[value="https://manual.invalid/mcp"]')).not.toBeNull();
  });
});
