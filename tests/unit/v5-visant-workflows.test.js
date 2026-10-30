// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { NewKeyDialog } from "../../src/app/(dashboard)/dashboard/mcp-gateway/McpGatewayComponents.jsx";
import ReviewCombosPage from "../../src/shared/ui/v5/combos/ReviewCombosPage.jsx";
import { installStoryNetwork } from "../../.storybook/network.js";
import { createRoutingFixture } from "../../src/shared/ui/v5/preservation/routing-fixtures.js";
import ComboAllowListEditor from "../../src/app/(dashboard)/dashboard/combos/ComboAllowListEditor.jsx";
import { afterEach, describe, it, expect, vi } from "vitest";
import { requestJSON, requestCollection, updateProviderConnections, createSettingsQueue } from "../../src/app/(dashboard)/dashboard/providers/workflowRequests.js";

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

describe("Visant workflow read/write truth", () => {
  it("rejects HTTP failures, malformed JSON and absent collection fields instead of returning empty configuration", async () => {
    await expect(requestJSON("/settings", undefined, async () => json({ error: "Unavailable" }, 503))).rejects.toThrow("Unavailable");
    await expect(requestCollection("/keys", "keys", async () => new Response("<html>bad</html>"))).rejects.toThrow("unreadable");
    await expect(requestCollection("/keys", "keys", async () => json({}))).rejects.toThrow("incomplete");
    await expect(requestCollection("/keys", "keys", async () => json({ keys: [] }))).resolves.toEqual([]);
    await expect(requestCollection("/keys", "keys", async () => { throw new Error("Offline"); })).rejects.toThrow("Offline");
  });

  it("retains failed provider accounts and confirms only the writes actually accepted", async () => {
    const accounts = [{ id: "accepted" }, { id: "rejected" }, { id: "offline" }];
    const request = vi.fn(async (url, options) => {
      expect(JSON.parse(options.body)).toEqual({ isActive: false });
      if (url.endsWith("offline")) throw new Error("Offline");
      return url.endsWith("rejected") ? json({ error: "Denied" }, 500) : json({ ok: true });
    });
    await expect(updateProviderConnections(accounts, false, request)).resolves.toEqual({ accepted: ["accepted"], failed: [accounts[1], accounts[2]] });
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("reports every failed provider write even when fetch resolves successfully", async () => {
    const accounts = [{ id: "a" }, { id: "b" }];
    await expect(updateProviderConnections(accounts, false, async () => json({ error: "No write" }, 503))).resolves.toEqual({ accepted: [], failed: accounts });
  });

  it("serializes settings writes so a delayed first response cannot replace a newer timeout or another combo", async () => {
    const first = deferred();
    const maps = [];
    const queue = createSettingsQueue({ alpha: { timeoutMs: 9000 } }, async (next) => { maps.push(next); if (maps.length === 1) await first.promise; });
    const a = queue.update((current) => ({ ...current, alpha: { ...current.alpha, timeoutMs: 12000 } }));
    const b = queue.update((current) => ({ ...current, beta: { fallbackStrategy: "weighted" } }));
    await Promise.resolve();
    expect(maps).toEqual([{ alpha: { timeoutMs: 12000 } }]);
    first.resolve(); await a; await b;
    expect(maps[1]).toEqual({ alpha: { timeoutMs: 12000 }, beta: { fallbackStrategy: "weighted" } });
  });

  it("recovers after rejection using confirmed data, retaining the failed draft only for explicit retry", async () => {
    let fail = true;
    const queue = createSettingsQueue({ alpha: { timeoutMs: 9000 } }, async () => { if (fail) { fail = false; throw new Error("Rejected"); } });
    await expect(queue.update((current) => ({ ...current, alpha: { timeoutMs: 12000 } }))).rejects.toThrow("Rejected");
    await expect(queue.update((current) => ({ ...current, beta: { fallbackStrategy: "smart" } }))).resolves.toEqual({ alpha: { timeoutMs: 9000 }, beta: { fallbackStrategy: "smart" } });
  });
});

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root;
let cleanupNetwork;
afterEach(async () => { if (root) await act(async () => root.unmount()); root = null; cleanupNetwork?.(); cleanupNetwork = null; document.body.innerHTML = ""; });
async function mount(component) { const container = document.createElement("div"); document.body.append(container); root = createRoot(container); await act(async () => root.render(component)); }
const button = (text) => [...document.querySelectorAll("button")].find((node) => node.textContent.trim().endsWith(text) || node.getAttribute("aria-label") === text);

describe("Visant credential and allow-list recovery", () => {
  it("awaits one credential submission, blocks dismissal while pending, and retains the form on rejection", async () => {
    const pending = deferred();
    const create = vi.fn(() => pending.promise.then(() => { throw new Error("Mint failed"); }));
    const close = vi.fn();
    await mount(React.createElement(NewKeyDialog, { onClose: close, onCreate: create }));
    const form = document.querySelector("form");
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(create).toHaveBeenCalledTimes(1);
    expect(button("Cancel").disabled).toBe(true);
    expect(button("Create key").disabled).toBe(true);
    await act(async () => { document.querySelector("dialog").dispatchEvent(new Event("cancel", { cancelable: true })); });
    expect(close).not.toHaveBeenCalled();
    await act(async () => pending.resolve());
    expect(document.querySelector('[role="alert"]').textContent).toContain("Mint failed");
    expect(button("Create key").disabled).toBe(false);
    expect(document.querySelector("form")).not.toBeNull();
  });

  it("preserves rejected restriction changes for retry while serializing repeated mutations", async () => {
    const pending = deferred();
    const save = vi.fn().mockImplementationOnce(() => pending.promise).mockResolvedValue({ ok: true });
    const props = { allowedConnectionIds: ["account-a"], connections: [{ id: "account-a", name: "Account A" }], groups: [], onChange: save };
    await mount(React.createElement(ComboAllowListEditor, props));
    const clear = [...document.querySelectorAll("button")].find((node) => node.textContent.includes("Clear (unrestrict)"));
    await act(async () => { clear.click(); clear.click(); });
    expect(save).toHaveBeenCalledTimes(1);
    expect(clear.disabled).toBe(true);
    await act(async () => pending.resolve({ ok: false, error: "Restriction rejected" }));
    expect(document.querySelector('[role="alert"]').textContent).toContain("Restriction rejected");
    await act(async () => [...document.querySelectorAll("button")].find((node) => node.textContent.includes("Retry")).click());
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0]).toEqual([]);
  });
});


it("retains a cleared timeout as a local draft until a complete replacement is explicitly committed", async () => {
  const fixture = createRoutingFixture({ settings: { comboStrategies: { "review-route": { timeoutMs: 9000 } } } });
  cleanupNetwork = installStoryNetwork({ routes: fixture.routes });
  await mount(React.createElement(ReviewCombosPage));
  const input = document.querySelector('input[aria-label="Timeout for review-route"]');
  expect(input.value).toBe("9");
  const fill = async (value) => act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await fill("");
  expect(input.value).toBe("");
  expect(fixture.snapshot().writes.filter((write) => write.key === "PATCH /api/settings")).toHaveLength(0);
  await fill("12");
  expect(input.value).toBe("12");
  await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  expect(fixture.snapshot().settings.comboStrategies["review-route"].timeoutMs).toBe(12000);
  expect(input.value).toBe("12");
});

it("ignores a settings refresh captured before a newer routing write", async () => {
  const fixture = createRoutingFixture({ settings: { comboStrategies: { "review-route": { timeoutMs: 9000 } } } });
  const getSettings = fixture.routes["GET /api/settings"];
  const oldRead = deferred();
  let hold = false;
  let captured;
  cleanupNetwork = installStoryNetwork({ routes: { ...fixture.routes, "GET /api/settings": async (...args) => {
    const result = await getSettings(...args);
    if (hold) { captured = result; return oldRead.promise; }
    return result;
  } } });
  await mount(React.createElement(ReviewCombosPage));
  hold = true;
  const clear = [...document.querySelectorAll("button")].find((node) => node.textContent.includes("Clear (unrestrict)"));
  await act(async () => clear.click());
  expect(captured.body.comboStrategies["review-route"].timeoutMs).toBe(9000);
  const input = document.querySelector('input[aria-label="Timeout for review-route"]');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "12");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  expect(fixture.snapshot().settings.comboStrategies["review-route"].timeoutMs).toBe(12000);
  await act(async () => oldRead.resolve(captured));
  expect(input.value).toBe("12");
});
