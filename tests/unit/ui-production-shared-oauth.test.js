// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import IFlowCookieModal from "@/shared/components/IFlowCookieModal";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const h = React.createElement;
const originalShowModal = HTMLDialogElement.prototype.showModal;
const originalClose = HTMLDialogElement.prototype.close;
const roots = [];

function installShim() {
  HTMLDialogElement.prototype.showModal = function shimShowModal() {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function shimClose() {
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

function findButton(name) {
  return Array.from(document.body.querySelectorAll("button")).find(
    (el) =>
      [...el.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent).join("").trim() === name || el.getAttribute("aria-label") === name,
  );
}

beforeEach(() => installShim());

afterEach(() => {
  while (roots.length) {
    const [root, container] = roots.pop();
    act(() => root.unmount());
    container.remove();
  }
  HTMLDialogElement.prototype.showModal = originalShowModal;
  HTMLDialogElement.prototype.close = originalClose;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("IFlowCookieModal (shared-oauth)", () => {
  it("cancels the post-success timer when the modal is closed before it fires", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ apiKey: "fresh" }) }));
    vi.stubGlobal("fetch", fetchMock);
    const onSuccess = vi.fn();
    const onClose = vi.fn();
    render(h(IFlowCookieModal, { isOpen: true, onSuccess, onClose }));
    const cookieField = document.body.querySelector("textarea");
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(cookieField, "BXAuth=abc");
      cookieField.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      findButton("Authenticate").click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalled();
    expect(document.querySelector("textarea")).toBeNull();
    expect(findButton("Authenticate")).toBeUndefined();
    // Close via the Modal header control while the 1500 ms success timer is
    // still pending; production must cancel it so onSuccess is never called
    // for an already-dismissed modal.
    act(() => findButton("Close").click());
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
