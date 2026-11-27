// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import CodexModal from "../../src/app/(dashboard)/dashboard/providers/[id]/BulkImportCodexModal.js";
import GrokModal from "../../src/app/(dashboard)/dashboard/providers/[id]/BulkImportGrokCliModal.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root;
let host;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  host?.remove();
  root = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each([["Codex", CodexModal], ["Grok", GrokModal]])("preserves %s import failure text", async (_name, Modal) => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 429, statusText: "Too Many Requests", json: async () => ({}) })));
  vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function () { this.setAttribute("open", ""); });
  vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function () { this.removeAttribute("open"); });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(React.createElement(Modal, { isOpen: true, onClose: vi.fn() })));
  const input = document.querySelector("textarea");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(input, '[{"accessToken":"example"}]');
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => [...document.querySelectorAll("button")].find((button) => button.textContent === "Import All").click());
  expect(document.body.textContent).toContain("Request failed: 429");
});
