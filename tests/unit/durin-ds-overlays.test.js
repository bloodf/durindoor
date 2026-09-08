// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import Modal from "@/shared/ui/components/Modal.jsx";
import Drawer from "@/shared/ui/components/Drawer.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const h = React.createElement;
const SHIM_MARKER = "overlayDialogShim";
const originalShowModal = HTMLDialogElement.prototype.showModal;
const originalClose = HTMLDialogElement.prototype.close;
const originalOverflowDescriptor = Object.getOwnPropertyDescriptor(document.body.style, "overflow");
const originalBodyOverflow = document.body.style.overflow;
const roots = [];
let showModalBehavior = "ok";

function installShim(behavior = "ok") {
  HTMLDialogElement.prototype.showModal = function shimShowModal() {
    showModalBehavior = behavior;
    this.dataset[SHIM_MARKER] = "1";
    if (behavior === "throw") throw new Error("native failure");
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function shimClose() {
    this.dataset[SHIM_MARKER] = "closed";
    this.removeAttribute("open");
  };
}

function render(element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push([root, container]);
  act(() => root.render(element));
  return { update: (next) => act(() => root.render(next)) };
}

function openDialog() {
  return document.querySelector("dialog[open]");
}

async function flush() {
  await act(async () => { await Promise.resolve(); });
}

beforeEach(() => {
  installShim("ok");
  showModalBehavior = "ok";
});

afterEach(() => {
  while (roots.length) {
    const [root, container] = roots.pop();
    act(() => root.unmount());
    container.remove();
  }
  HTMLDialogElement.prototype.showModal = originalShowModal;
  HTMLDialogElement.prototype.close = originalClose;
  showModalBehavior = "ok";
  document.body.innerHTML = "";
  document.body.style.overflow = originalBodyOverflow;
  if (originalOverflowDescriptor) {
    Object.defineProperty(document.body.style, "overflow", originalOverflowDescriptor);
  }
});

describe("Modal overlay contract", () => {
  it("unmounts closed content and never renders a fallback open attribute", async () => {
    render(h(Modal, { open: false, onClose: vi.fn(), title: "Closed" }, "child"));
    await flush();
    expect(document.querySelector("dialog")).toBeNull();
  });

  it("routes native cancel only through enabled dismissal", async () => {
    const onClose = vi.fn();
    render(h(Modal, { open: true, onClose, title: "Escape" }, "body"));
    await flush();
    const dialog = openDialog();
    expect(dialog instanceof HTMLDialogElement).toBe(true);
    dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
    expect(onClose.mock.calls.length).toBe(1);
  });

  it("ignores pending cancel and pending close button clicks", async () => {
    const onClose = vi.fn();
    render(h(Modal, { open: true, onClose, pending: true, title: "Pending" }, "body"));
    await flush();
    const dialog = openDialog();
    dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
    const close = dialog.querySelector("button[aria-label='Close']");
    expect(close.disabled).toBe(true);
    close.click();
    expect(onClose.mock.calls.length).toBe(0);
  });

  it("requires matching backdrop pointer origins before dismissal", async () => {
    const onClose = vi.fn();
    render(h(Modal, { open: true, onClose, title: "Backdrop" }, "body"));
    await flush();
    const dialog = openDialog();
    const panel = dialog.querySelector("section");
    panel.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    dialog.dispatchEvent(new Event("pointerup", { bubbles: true }));
    expect(onClose.mock.calls.length).toBe(0);
    dialog.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    dialog.dispatchEvent(new Event("pointerup", { bubbles: true }));
    expect(onClose.mock.calls.length).toBe(1);
  });

  it("restores scroll lock through close and nested cleanup", async () => {
    document.body.style.overflow = "scroll";
    const child = h(Modal, { open: true, onClose: vi.fn(), title: "Child" }, "child");
    const harness = render(h(Modal, { open: true, onClose: vi.fn(), title: "Parent" }, child));
    await flush();
    expect(document.body.style.overflow).toBe("hidden");
    harness.update(h(Modal, { open: false, onClose: vi.fn(), title: "Parent" }, null));
    await flush();
    expect(document.body.style.overflow).toBe("scroll");
  });

  it("focuses a valid descendant ref, then autofocus, then native controls", async () => {
    const targetRef = { current: null };
    function Content() {
      return h("input", { ref: targetRef, "aria-label": "Target", autoFocus: true });
    }
    render(h(Modal, { open: true, onClose: vi.fn(), title: "Focus", initialFocus: targetRef }, h(Content)));
    await flush();
    expect(document.activeElement).toBe(targetRef.current);
  });

  it("wraps keyboard focus at visible tab stops without targeting excluded controls", async () => {
    render(h(Modal, { open: true, onClose: vi.fn(), title: "Keyboard" },
      h("button", { tabIndex: -1 }, "Skipped"),
      h("div", { hidden: true }, h("button", null, "Hidden")),
      h("button", null, "Last")));
    await flush();
    const dialog = openDialog();
    dialog.focus();
    dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(dialog.querySelector("button[aria-label='Close']"));
    const first = dialog.querySelector("button[aria-label='Close']");
    const last = [...dialog.querySelectorAll("button")].at(-1);
    first.focus();
    first.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(last);
    last.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(first);
  });

  it("falls back when initialFocus selector throws and keeps scroll lock", async () => {
    render(h(Modal, { open: true, onClose: vi.fn(), title: "Bad selector", initialFocus: "[" }, "body"));
    await flush();
    const dialog = openDialog();
    expect(dialog instanceof HTMLDialogElement).toBe(true);
    expect(document.activeElement).toBe(dialog.querySelector("button[aria-label='Close']"));
    expect(document.body.style.overflow).toBe("hidden");
  });
  it("falls back when initialFocus ref target is detached and keeps scroll lock", async () => {
    const detached = document.createElement("button");
    document.body.appendChild(detached);
    detached.remove();
    render(h(Modal, { open: true, onClose: vi.fn(), title: "Detached ref", initialFocus: { current: detached } }, "body"));
    await flush();
    const dialog = openDialog();
    expect(dialog instanceof HTMLDialogElement).toBe(true);
    expect(document.activeElement).toBe(dialog.querySelector("button[aria-label='Close']"));
    expect(document.body.style.overflow).toBe("hidden");
  });


  it("surfaces native showModal failure instead of falling back to setAttribute", () => {
    showModalBehavior = "throw";
    installShim("throw");
    let thrown;
    try {
      render(h(Modal, { open: true, onClose: vi.fn(), title: "Failure" }, "body"));
    } catch (error) {
      thrown = error;
    }
    expect(thrown?.message).toBe("native failure");
    expect(document.querySelector("dialog[open]")).toBeNull();
    expect(document.body.style.overflow).toBe("");
  });

  it("returns focus only to connected opener", async () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const harness = render(h(Modal, { open: true, onClose: vi.fn(), title: "Return" }, "body"));
    await flush();
    opener.remove();
    harness.update(h(Modal, { open: false, onClose: vi.fn(), title: "Return" }, "body"));
    await flush();
    expect(document.activeElement).toBe(document.body);
  });
});

describe("Drawer overlay contract", () => {
  it("keeps Drawer width and pending close semantics", async () => {
    const onClose = vi.fn();
    render(h(Drawer, { open: true, onClose, title: "Inspect", width: 560, pending: true }, "body"));
    await flush();
    const dialog = openDialog();
    expect(dialog.querySelector("section").style.width).toBe("560px");
    const close = dialog.querySelector("button[aria-label='Close']");
    expect(close.disabled).toBe(true);
    close.click();
    expect(onClose.mock.calls.length).toBe(0);
  });
});
