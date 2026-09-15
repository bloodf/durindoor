// @vitest-environment happy-dom
/**
 * MCP Gateway keys page, split out of the combined gateway page.
 *
 * The interesting property is the seam: the page renders only keys, but still
 * needs the instance list for the grants modal. Those two facts pull in
 * opposite directions, and a split that got either wrong would either show an
 * instances section on the keys page or offer an empty grants picker.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { within } from "@testing-library/dom";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { notify } = vi.hoisted(() => ({ notify: vi.fn() }));
vi.mock("@/store/notificationStore", () => ({
  useNotificationStore: (selector) => selector({ addNotification: notify })
}));
vi.mock("@/shared/hooks/useCopyToClipboard", () => ({
  useCopyToClipboard: () => ({ copied: null, copy: vi.fn() })
}));

import McpGatewayKeysPage from "@/app/(dashboard)/dashboard/mcp-gateway/keys/page.js";

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

const noInstances = (method, url) =>
  method === "GET" && url.endsWith("/api/mcp-gateway/instances") && mockJsonResponse({ instances: [] });

describe("MCP Gateway keys page", () => {
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

  it("renders keys and links back to instances without rendering them", async () => {
    globalThis.fetch = makeFetchMock([
      noInstances,
      (method, url) => method === "GET" && url.endsWith("/api/mcp-gateway/keys") && mockJsonResponse({ keys: [] })
    ]);
    await act(async () => {
      root.render(React.createElement(McpGatewayKeysPage, null));
    });
    await flush();
    expect(container.textContent).toContain("Gateway Keys");
    expect(container.textContent).toContain("New key");
    expect(container.textContent).toContain("No gateway keys yet");
    // Instances are fetched for the grants picker but never shown as a section.
    expect(container.textContent).not.toContain("No instances yet");
    expect(container.querySelector('a[href="/dashboard/mcp-gateway"]')).not.toBeNull();
  });

  it("renders key rows with machine id and creation date metadata", async () => {
    globalThis.fetch = makeFetchMock([
      noInstances,
      (method, url) => method === "GET" && url.endsWith("/api/mcp-gateway/keys") && mockJsonResponse({ keys: [
        { id: "k1", name: "Cursor laptop", machineId: "ab12cd34-1234-5678-9abc-def012345678", createdAt: "2026-08-21T10:00:00Z" },
        { id: "k2", name: null, machineId: null, createdAt: "2026-09-01T15:30:00Z" }
      ] })
    ]);
    await act(async () => {
      root.render(React.createElement(McpGatewayKeysPage, null));
    });
    await flush();
    expect(container.textContent).toContain("Cursor laptop");
    expect(container.textContent).toContain("ab12cd34");
    expect(container.textContent).toContain("Unnamed key");
  });

  it("fresh-mounts New key and submits an optional blank name through its footer form", async () => {
    const fetch = makeFetchMock([
      noInstances,
      (method, url) => method === "GET" && url.endsWith("/api/mcp-gateway/keys") && mockJsonResponse({ keys: [] }),
      (method, url) => method === "POST" && url.endsWith("/api/mcp-gateway/keys") && mockJsonResponse({ key: { id: "k-new", key: "sk-test" } })
    ]);
    globalThis.fetch = fetch;
    await act(async () => {
      root.render(React.createElement(McpGatewayKeysPage, null));
    });
    await flush();
    const open = within(container.querySelector("header")).getByRole("button", { name: "New key" });
    await act(async () => { open.click(); });
    const input = document.body.querySelector("input");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "Discarded");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { document.body.querySelector('button[aria-label="Close"]').click(); });
    await act(async () => { open.click(); });
    const reopenedInput = document.body.querySelector("input");
    expect(reopenedInput.value).toBe("");
    const form = reopenedInput.closest("form");
    const submit = within(document.body).getByRole("button", { name: "Create key" });
    expect(submit.getAttribute("form")).toBe(form.id);
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await flush();
    const call = fetch.mock.calls.find(([url, init]) => init?.method === "POST" && url.endsWith("/api/mcp-gateway/keys"));
    expect(JSON.parse(call[1].body)).toEqual({ name: null });
  });

  it("offers the fetched instances as grant checkboxes", async () => {
    // The whole reason this page still fetches instances. If the split had
    // dropped that fetch, the modal would render its empty state and the
    // operator could never grant anything.
    globalThis.fetch = makeFetchMock([
      (method, url) => method === "GET" && url.endsWith("/api/mcp-gateway/instances") && mockJsonResponse({ instances: [
        { id: "i1", slug: "jira-acme", kind: "http", transport: "http", url: "https://jira.example/mcp", enabled: true }
      ] }),
      (method, url) => method === "GET" && url.endsWith("/api/mcp-gateway/keys") && mockJsonResponse({ keys: [
        { id: "k1", name: "Cursor laptop", machineId: null, createdAt: "2026-08-21T10:00:00Z" }
      ] }),
      (method, url) => method === "GET" && url.endsWith("/api/mcp-gateway/keys/k1") && mockJsonResponse({ grants: [] })
    ]);
    await act(async () => {
      root.render(React.createElement(McpGatewayKeysPage, null));
    });
    await flush();
    await act(async () => {
      within(container).getByRole("button", { name: "Manage grants" }).click();
    });
    await flush();
    expect(document.body.textContent).toContain("jira-acme");
    expect(document.body.textContent).not.toContain("No instances exist yet");
  });

  it("saves the grants the operator ticked", async () => {
    const fetch = makeFetchMock([
      (method, url) => method === "GET" && url.endsWith("/api/mcp-gateway/instances") && mockJsonResponse({ instances: [
        { id: "i1", slug: "jira-acme", kind: "http", transport: "http", url: "https://jira.example/mcp", enabled: true }
      ] }),
      (method, url) => method === "GET" && url.endsWith("/api/mcp-gateway/keys") && mockJsonResponse({ keys: [
        { id: "k1", name: "Cursor laptop", machineId: null, createdAt: "2026-08-21T10:00:00Z" }
      ] }),
      (method, url) => method === "GET" && url.endsWith("/api/mcp-gateway/keys/k1") && mockJsonResponse({ grants: [] }),
      (method, url) => method === "PUT" && url.endsWith("/api/mcp-gateway/keys/k1") && mockJsonResponse({ ok: true })
    ]);
    globalThis.fetch = fetch;
    await act(async () => {
      root.render(React.createElement(McpGatewayKeysPage, null));
    });
    await flush();
    await act(async () => {
      within(container).getByRole("button", { name: "Manage grants" }).click();
    });
    await flush();
    const checkbox = document.body.querySelector('input[type="checkbox"]');
    await act(async () => { checkbox.click(); });
    await act(async () => {
      within(document.body).getByRole("button", { name: "Save grants" }).click();
    });
    await flush();
    const call = fetch.mock.calls.find(([url, init]) => init?.method === "PUT" && url.endsWith("/api/mcp-gateway/keys/k1"));
    expect(JSON.parse(call[1].body)).toEqual({ grants: ["i1"] });
  });
});
