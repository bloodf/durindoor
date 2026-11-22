// @vitest-environment happy-dom
import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Modal from "../../src/shared/components/Modal.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host;
let root;
let showModal;
let fetchMock;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  showModal = vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function show() {
    this.setAttribute("open", "");
  });
  fetchMock = vi.fn(async () => ({ ok: true }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  delete document.documentElement.dataset.ui;
  showModal.mockRestore();
  vi.unstubAllGlobals();
});

async function render(v5, onClose = vi.fn()) {
  if (v5) document.documentElement.dataset.ui = "v5";
  else delete document.documentElement.dataset.ui;
  function Fixture() {
    const [open, setOpen] = useState(false);
    const save = React.createElement("button", { type: "button", onClick: () => fetch("/v1/settings", { method: "PATCH", body: JSON.stringify({ enabled: true }) }) }, "Save");
    return React.createElement(React.Fragment, null,
      React.createElement("button", { type: "button", onClick: () => setOpen(true) }, "Opener"),
      React.createElement(Modal, { isOpen: open, onClose: () => { onClose(); setOpen(false); }, title: "Modal test", footer: save },
        React.createElement("button", { type: "button" }, "First"),
        React.createElement("button", { type: "button" }, "Last"),
        React.createElement("div", { style: { height: "1200px" } }, "Scrollable content"),
      ),
    );
  }
  await act(async () => root.render(React.createElement(Fixture)));
  document.querySelector("button").focus();
  await act(async () => document.querySelector("button").click());
  return document.body.querySelector("dialog");
}

describe.each([false, true])("shared modal base with V5 %s", (v5) => {
  it("keeps the accessible dialog, focus management, mobile scroll surface, and caller request", async () => {
    const onClose = vi.fn();
    const dialog = await render(v5, onClose);

    expect(dialog.hasAttribute("open")).toBe(true);
    expect(dialog.getAttribute("aria-labelledby")).toBeTruthy();
    expect(document.getElementById(dialog.getAttribute("aria-labelledby")).textContent).toBe("Modal test");
    expect(dialog.querySelector("[role='document'] > div").className).toContain("overflow-y-auto");
    expect(dialog.querySelector("[role='document']").className.includes("max-[480px]:w-full")).toBe(v5);
    expect(dialog.querySelector("button[aria-label='Close']")).toBeTruthy();
    expect(document.activeElement).toBe(dialog.querySelector("button[aria-label='Close']"));
    const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    dialog.querySelectorAll("button")[3].focus();
    await act(async () => dialog.querySelectorAll("button")[3].dispatchEvent(tab));
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(dialog.querySelector("button[aria-label='Close']"));

    await act(async () => dialog.querySelector("button[aria-label='Close']").click());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(document.querySelector("button"));
    expect(onClose).toHaveBeenCalledTimes(1);

    await act(async () => document.querySelector("button").click());
    const reopened = document.body.querySelector("dialog");
    await act(async () => reopened.dispatchEvent(new Event("cancel", { bubbles: true, cancelable: true })));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(document.body.querySelector("dialog")).toBeNull();
    expect(document.activeElement).toBe(document.querySelector("button"));

    const save = React.createElement("button", { type: "button", onClick: () => fetch("/v1/settings", { method: "PATCH", body: JSON.stringify({ enabled: true }) }) }, "Save");
    await act(async () => root.render(React.createElement(Modal, { isOpen: true, onClose, title: "Modal test", footer: save }, React.createElement("button", { type: "button" }, "First"))));
    await act(async () => document.body.querySelector("dialog").querySelector("footer button").click());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/v1/settings", { method: "PATCH", body: JSON.stringify({ enabled: true }) });
    expect(document.documentElement.dataset.ui ?? "").toBe(v5 ? "v5" : "");
  });
});
