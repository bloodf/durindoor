// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import { URL as NodeURL, fileURLToPath } from "node:url";
import { resolve } from "node:path";
import EditConnectionModal from "@/shared/components/EditConnectionModal.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const message = "Could not save connection. Your changes are still here. Try again.";
let root, container;
const originalShow = HTMLDialogElement.prototype.showModal;
const originalClose = HTMLDialogElement.prototype.close;
const button = (text) => [...document.querySelectorAll("button")].find((node) => node.textContent.trim() === text);

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network request"); }));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  HTMLDialogElement.prototype.showModal = originalShow;
  HTMLDialogElement.prototype.close = originalClose;
  vi.unstubAllGlobals();
});

describe("EditConnectionModal failed save feedback", () => {
  it("blocks dismissal while pending, announces failure safely, keeps the draft and retries", async () => {
    let rejectSave;
    const onSave = vi.fn().mockImplementationOnce(() => new Promise((_, reject) => { rejectSave = reject; })).mockResolvedValueOnce(undefined);
    const onClose = vi.fn();
    const connection = { id: "synthetic-edit", provider: "openai", authType: "oauth", name: "Original", priority: 1, providerSpecificData: {} };
    await act(async () => root.render(React.createElement(EditConnectionModal, { isOpen: true, connection, onSave, onClose })));
    const label = [...document.querySelectorAll("label")].find((node) => node.textContent.trim() === "Name");
    const input = document.getElementById(label.htmlFor);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "Retained draft");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => button("Save").click());
    const dialog = document.querySelector("dialog[open]");
    expect(button("Cancel").disabled).toBe(true);
    expect(document.querySelector("button[aria-label='Close']").disabled).toBe(true);
    await act(async () => {
      button("Cancel").click();
      document.querySelector("button[aria-label='Close']").click();
      dialog.dispatchEvent(new Event("cancel", { bubbles: true, cancelable: true }));
      dialog.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      dialog.dispatchEvent(new Event("pointerup", { bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(onSave).toHaveBeenCalledTimes(1);
    await act(async () => rejectSave(new Error("synthetic-secret-must-not-render")));
    expect(document.querySelector("[role='alert']").textContent).toBe(message);
    expect(document.body.textContent).not.toContain("synthetic-secret-must-not-render");
    expect(input.value).toBe("Retained draft");
    expect(dialog.hasAttribute("open")).toBe(true);
    expect(button("Cancel").disabled).toBe(false);
    expect(button("Save").disabled).toBe(false);
    await act(async () => button("Save").click());
    expect(document.querySelector("[role='alert']")).toBeNull();
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave.mock.calls[0][0].name).toBe("Retained draft");
    expect(onSave.mock.calls[1][0]).toEqual(onSave.mock.calls[0][0]);
    expect(fetch).not.toHaveBeenCalled();
    await act(async () => button("Cancel").click());
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// Run the actual caller function bodies with synthetic boundary dependencies.
// No copied save implementation and no provider/database access.
const callers = [
  "src/app/(dashboard)/dashboard/providers/[id]/page.js",
  "src/app/(dashboard)/dashboard/providers/components/ConnectionsCard.js",
  "src/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.js",
];
for (const path of callers) {
  it(`${path} propagates HTTP and network failures without closing`, async () => {
    const source = readFileSync(resolve(fileURLToPath(new NodeURL("../../", import.meta.url)), path), "utf8");
    const start = source.indexOf("  const handleUpdateConnection = ");
    const callback = source.slice(start).startsWith("  const handleUpdateConnection = useCallback(");
    const endMarker = callback ? "\n  );" : "\n  };";
    const end = source.indexOf(endMarker, start) + endMarker.length;
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const fetchBoundary = vi.fn().mockResolvedValueOnce({ ok: false, status: 503 }).mockRejectedValueOnce(new Error("synthetic network failure"));
    const refresh = vi.fn();
    const close = vi.fn();
    const select = vi.fn();
    const factory = new Function("fetch", "selectedConnection", "fetchConnections", "fetch_", "setShowEditModal", "setSelectedConnection", "fetchQuota", "USAGE_SUPPORTED_PROVIDERS", "useCallback", `${source.slice(start, end)}; return handleUpdateConnection;`);
    const save = factory(fetchBoundary, { id: "synthetic-edit", provider: "openai" }, refresh, refresh, close, select, vi.fn(), [], (fn) => fn);
    await expect(save({ name: "Draft" })).rejects.toThrow("Failed to save connection");
    await expect(save({ name: "Draft" })).rejects.toThrow("synthetic network failure");
    expect(refresh).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
    expect(fetchBoundary).toHaveBeenCalledWith("/api/providers/synthetic-edit", { method: "PUT", headers: { "Content-Type": "application/json" }, body: '{"name":"Draft"}' });
    fetchBoundary.mockResolvedValueOnce({ ok: true });
    await save({ name: "Draft" });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledWith(false);
  });
}
