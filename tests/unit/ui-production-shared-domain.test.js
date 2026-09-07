// @vitest-environment happy-dom
import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { within } from "@testing-library/dom";
import ComboFormModal from "@/shared/components/ComboFormModal";
import PricingModal from "@/shared/components/PricingModal";
import McpMarketplaceModal from "@/shared/components/McpMarketplaceModal";
vi.mock("@/shared/components/ModelSelectModal", () => ({ default: () => null }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const mounts = [];
async function render(element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(element);
  });
  mounts.push([root, container]);
  return { container, root };
}
async function dispose() {
  while (mounts.length) {
    const [root, container] = mounts.pop();
    await act(async () => {
      root.unmount();
    });
    container.remove();
  }
}
function deferred() {
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
}
function PricingHarness({ children, onSaveSpy }) {
  const [open, setOpen] = useState(true);
  return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(PricingModal, { isOpen: open, onClose: () => setOpen(false), onSave: onSaveSpy }), open ? null : /* @__PURE__ */ React.createElement("button", { type: "button", onClick: () => setOpen(true) }, "Reopen pricing"));
}
function MarketplaceHarness({ onAdd }) {
  const [added, setAdded] = useState([]);
  const handler = (server) => {
    onAdd?.(server);
    setAdded((prev) => prev.includes(server.name) ? prev : [...prev, server.name]);
  };
  return /* @__PURE__ */ React.createElement(McpMarketplaceModal, { isOpen: true, onClose: () => {
  }, onAdd: handler, addedNames: added });
}
const getByRole = (role, name) => within(document.body).getByRole(role, { name });
async function waitFor(probe) {
  const start = Date.now();
  while (Date.now() - start < 5e3) {
    try {
      const out = probe();
      if (out) return out;
    } catch (_) {
    }
    await act(async () => {
      await new Promise((res) => setTimeout(res, 10));
    });
  }
  throw new Error("waitFor timed out");
}
async function mountFresh(element) {
  await dispose();
  return render(element);
}
describe("shared-domain production components", () => {
  let originalFetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(async () => {
    globalThis.fetch = originalFetch;
    await dispose();
  });
  it("ComboFormModal exposes stable id wired to the prefixed-name label", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ aliases: {} }) });
    const onSave = vi.fn().mockResolvedValue(void 0);
    await render(/* @__PURE__ */ React.createElement(ComboFormModal, { isOpen: true, onClose: () => {
    }, onSave, forcePrefix: "claude-", activeProviders: [] }));
    const label = document.querySelector("label");
    expect(label?.textContent).toBe("Combo name");
    const forId = label?.getAttribute("for");
    expect(forId).toBeTruthy();
    const input = document.getElementById(forId);
    expect(input).toBeTruthy();
  });
  it("PricingModal: save updates backing state, reopen shows saved values", async () => {
    const initial = {
      openai: { "gpt-5": { input: 2.5, output: 10, cached: 0, reasoning: 0, cache_creation: 0 } }
    };
    const store = JSON.parse(JSON.stringify(initial));
    const calls = { patch: 0 };
    globalThis.fetch = vi.fn().mockImplementation((url, init) => {
      const method = (init?.method || "GET").toUpperCase();
      if (method === "GET") return Promise.resolve({ ok: true, json: () => Promise.resolve(JSON.parse(JSON.stringify(store))) });
      if (method === "PATCH") {
        calls.patch += 1;
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) }).then(async (res) => {
          const body = JSON.parse(init.body);
          store.openai["gpt-5"] = { ...store.openai["gpt-5"], ...body.openai["gpt-5"] };
          return res;
        });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    });
    await render(/* @__PURE__ */ React.createElement(PricingHarness, null));
    const gptInput = await waitFor(() => document.querySelector('input[aria-label="gpt-5 input rate"]'));
    expect(Number(gptInput.value)).toBe(2.5);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(gptInput, "5.5");
      gptInput.dispatchEvent(new Event("input", { bubbles: true }));
      gptInput.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await waitFor(() => Number(gptInput.value) === 5.5);
    await act(async () => {
      getByRole("button", "Save changes").click();
    });
    await waitFor(() => calls.patch === 1);
    await waitFor(() => getByRole("button", "Reopen pricing"));
    await act(async () => {
      getByRole("button", "Reopen pricing").click();
    });
    const reopened = await waitFor(() => document.querySelector('input[aria-label="gpt-5 input rate"]'));
    expect(Number(reopened.value)).toBe(5.5);
  });
  it("PricingModal: save error surfaces server message and keeps modal open", async () => {
    globalThis.fetch = vi.fn().mockImplementation((url, init) => {
      const method = (init?.method || "GET").toUpperCase();
      if (method === "GET") return Promise.resolve({ ok: true, json: () => Promise.resolve({ openai: { "gpt-5": { input: 1, output: 2, cached: 0, reasoning: 0, cache_creation: 0 } } }) });
      if (method === "PATCH") return Promise.resolve({ ok: false, status: 423, json: () => Promise.resolve({ error: "rate-locked" }) });
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    });
    await render(/* @__PURE__ */ React.createElement(PricingHarness, null));
    const input = await waitFor(() => document.querySelector('input[aria-label="gpt-5 input rate"]'));
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "7");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await waitFor(() => Number(input.value) === 7);
    await act(async () => {
      getByRole("button", "Save changes").click();
    });
    const alert = await waitFor(() => document.querySelector('[role="alert"]'));
    expect(alert.textContent).toContain("rate-locked");
    expect(() => getByRole("button", "Reopen pricing")).toThrow();
  });
  it("PricingModal: load error surfaces server message; component still renders table from default pricing", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503, json: () => Promise.resolve({ error: "db offline" }) });
    await render(/* @__PURE__ */ React.createElement(PricingHarness, null));
    const alert = await waitFor(() => document.querySelector('[role="alert"]'));
    expect(alert.textContent).toContain("db offline");
    const anyRate = await waitFor(() => document.querySelector('input[aria-label$="rate"]'));
    expect(anyRate).toBeTruthy();
  });
  it("PricingModal: reset error surfaces server message and closes confirm", async () => {
    globalThis.fetch = vi.fn().mockImplementation((url, init) => {
      const method = (init?.method || "GET").toUpperCase();
      if (method === "GET") return Promise.resolve({ ok: true, json: () => Promise.resolve({ openai: { "gpt-5": { input: 1, output: 2, cached: 0, reasoning: 0, cache_creation: 0 } } }) });
      if (method === "DELETE") return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ error: "reset denied" }) });
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    });
    await render(/* @__PURE__ */ React.createElement(PricingHarness, null));
    await waitFor(() => document.querySelector('input[aria-label="gpt-5 input rate"]'));
    await act(async () => {
      getByRole("button", "Reset to defaults").click();
    });
    const dialog = await waitFor(() => getByRole("dialog", "Reset pricing to defaults?"));
    await act(async () => {
      within(dialog).getByRole("button", { name: "Reset" }).click();
    });
    const alert = await waitFor(() => document.querySelector('[role="alert"]'));
    expect(alert.textContent).toContain("reset denied");
    await waitFor(() => {
      try {
        getByRole("dialog", "Reset pricing to defaults?");
        return false;
      } catch {
        return true;
      }
    });
  });
  it("PricingModal: reset pending disables confirm buttons, Cancel is no-op, success swaps to reset payload", async () => {
    const initial = { openai: { "gpt-5": { input: 2.5, output: 10, cached: 0, reasoning: 0, cache_creation: 0 } } };
    const deferredReset = deferred();
    globalThis.fetch = vi.fn().mockImplementation((url, init) => {
      const method = (init?.method || "GET").toUpperCase();
      if (method === "GET") return Promise.resolve({ ok: true, json: () => Promise.resolve(initial) });
      if (method === "DELETE") return deferredReset.promise.then(() => ({
        ok: true,
        json: () => Promise.resolve({ openai: { "gpt-5": { input: 1, output: 4, cached: 0, reasoning: 0, cache_creation: 0 } } })
      }));
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    });
    await render(/* @__PURE__ */ React.createElement(PricingHarness, null));
    const initialInput = await waitFor(() => document.querySelector('input[aria-label="gpt-5 input rate"]'));
    expect(Number(initialInput.value)).toBe(2.5);
    await act(async () => {
      getByRole("button", "Reset to defaults").click();
    });
    const dialog = await waitFor(() => getByRole("dialog", "Reset pricing to defaults?"));
    const resetBtn = within(dialog).getByRole("button", { name: "Reset" });
    const cancelBtn = within(dialog).getByRole("button", { name: "Cancel" });
    await act(async () => {
      resetBtn.click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    await waitFor(() => resetBtn.disabled === true);
    await waitFor(() => cancelBtn.disabled === true);
    await act(async () => {
      cancelBtn.click();
    });
    expect(() => getByRole("dialog", "Reset pricing to defaults?")).not.toThrow();
    deferredReset.resolve();
    await waitFor(() => {
      try {
        getByRole("dialog", "Reset pricing to defaults?");
        return false;
      } catch {
        return true;
      }
    });
    const updated = await waitFor(() => document.querySelector('input[aria-label="gpt-5 input rate"]'));
    expect(Number(updated.value)).toBe(1);
  });
  it("McpMarketplaceModal: per-server add selection scoped, probe.error + requiresAuth branches surface", async () => {
    const registry = {
      servers: [
        { slug: "fs", name: "fs", title: "Local FS", description: "Read & write local files.", url: "https://example.com/mcp/fs", oauth: false, toolCount: 2, toolNames: ["read", "write"] },
        { slug: "github", name: "github", title: "GitHub", description: "OAuth server.", url: "https://api.github.com/mcp", oauth: true, toolCount: 1, toolNames: ["list_repos"] },
        { slug: "broken", name: "broken", title: "Broken", description: "Probe fails.", url: "https://example.com/mcp/broken", oauth: false, toolCount: 0 }
      ]
    };
    const payloads = [];
    globalThis.fetch = vi.fn().mockImplementation((url, init) => {
      const method = (init?.method || "GET").toUpperCase();
      if (method === "GET") return Promise.resolve({ ok: true, json: () => Promise.resolve(registry) });
      if (method === "POST") {
        const body = JSON.parse(init.body);
        if (body.url === "https://api.github.com/mcp") return Promise.resolve({ ok: true, json: () => Promise.resolve({ tools: [{ name: "list_repos" }], requiresAuth: true }) });
        if (body.url === "https://example.com/mcp/broken") return Promise.resolve({ ok: false, status: 502, json: () => Promise.resolve({ error: "endpoint refused" }) });
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ tools: [{ name: "read" }, { name: "write" }] }) });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    });
    await render(/* @__PURE__ */ React.createElement(MarketplaceHarness, { onAdd: (server) => payloads.push({ name: server.name, toolNames: server.toolNames }) }));
    const brokenRow = await waitFor(() => Array.from(document.querySelectorAll("li")).find((node) => node.textContent.includes("Broken")));
    await act(async () => {
      within(brokenRow).getByRole("button", { name: "Add" }).click();
    });
    const brokenAlert = await waitFor(() => within(brokenRow).getByRole("alert"));
    expect(brokenAlert.textContent).toContain("Probe failed: endpoint refused");
    const githubRow = await waitFor(() => Array.from(document.querySelectorAll("li")).find((node) => node.textContent.includes("GitHub")));
    await act(async () => {
      within(githubRow).getByRole("button", { name: "Add" }).click();
    });
    expect(within(githubRow).getByText(/OAuth required/)).toBeTruthy();
    expect(within(githubRow).getByRole("button", { name: "Confirm add" })).toBeTruthy();
    const fsRow = await waitFor(() => Array.from(document.querySelectorAll("li")).find((node) => node.textContent.includes("Local FS")));
    await act(async () => {
      within(fsRow).getByRole("button", { name: "Add" }).click();
    });
    const writeToggle = within(fsRow).getByRole("checkbox", { name: "write" });
    await act(async () => {
      writeToggle.click();
    });
    await act(async () => {
      within(fsRow).getByRole("button", { name: "Confirm add" }).click();
    });
    await waitFor(() => within(fsRow).getByRole("button", { name: "Added" }));
    expect(payloads).toEqual([{ name: "fs", toolNames: ["read"] }]);
    expect(within(githubRow).getByRole("button", { name: "Add" })).toBeTruthy();
  });
});
