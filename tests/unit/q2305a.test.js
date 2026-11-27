// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";

const { notify } = vi.hoisted(() => ({ notify: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/store/notificationStore", () => ({ useNotificationStore: () => notify }));
vi.mock("@/shared/utils/visiblePoller", () => ({ createVisiblePoller: () => ({ start() {}, stop() {} }) }));
import Badge from "@/app/(dashboard)/dashboard/providers/components/ModelAvailabilityBadge.js";
import EditModal from "@/app/(dashboard)/dashboard/providers/[id]/EditCompatibleNodeModal.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host, root;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  host?.remove(); root = null;
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});
async function render(Component, props = {}) {
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  await act(async () => root.render(React.createElement(Component, props)));
}
it("allows raw fetch only for documented streams", () => {
  const base = "../../src/app/(dashboard)/dashboard/providers/";
  for (const file of ["components/ModelsCard.js", "components/ModelAvailabilityBadge.js", "page.js", "[id]/AddCustomModelModal.js", "[id]/EditCompatibleNodeModal.js", "[id]/BulkImportCodexModal.js", "[id]/BulkImportGrokCliModal.js"]) {
    const lines = readFileSync(new URL(base + file, import.meta.url), "utf8").split("\n");
    for (let i = 0; i < lines.length; i++) if (/\bfetch\s*\(/.test(lines[i])) expect(lines[i - 1]).toMatch(/\/\/.*(?:stream|binary)/i);
  }
});
it("preserves cooldown failure message", async () => {
  vi.stubGlobal("fetch", vi.fn(async (_url, options) => options?.method === "POST"
    ? { ok: false, status: 500, json: async () => ({ error: "server error" }) }
    : { ok: true, json: async () => ({ unavailableCount: 1, models: [{ provider: "test", model: "m", status: "cooldown" }] }) }));
  await render(Badge);
  await act(async () => host.querySelector('button[aria-haspopup="dialog"]').click());
  await act(async () => host.querySelector('button[aria-label^="Clear "]').click());
  expect(notify.error).toHaveBeenCalledWith("Failed to clear cooldown");
});
it("preserves validation failure message", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: "server error" }) })));
  vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function () { this.setAttribute("open", ""); });
  vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function () { this.removeAttribute("open"); });
  await render(EditModal, { isOpen: true, node: { id: "n", baseUrl: "https://example.com" }, onSave: vi.fn(), onClose: vi.fn() });
  const input = [...document.querySelectorAll("input")].find((el) => el.type === "password");
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "key"); input.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => [...document.querySelectorAll("button")].find((el) => el.textContent.trim() === "Check").click());
  expect(document.body.textContent).toContain("Invalid");
});
