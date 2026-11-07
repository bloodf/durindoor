// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import AddCompatibleModal from "@/app/(dashboard)/dashboard/providers/components/AddCompatibleModal.js";

let root;
let host;
const originalShowModal = HTMLDialogElement.prototype.showModal;
const originalClose = HTMLDialogElement.prototype.close;
const button = (dialog, label) => [...dialog.querySelectorAll("button")]
  .find((node) => node.textContent.trim() === label);

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  // happy-dom supplies DOM assertions; this shim does not prove native dialog behavior.
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  HTMLDialogElement.prototype.showModal = originalShowModal;
  HTMLDialogElement.prototype.close = originalClose;
  vi.unstubAllGlobals();
});

describe.each(["openai", "anthropic"])("%s compatible Check announcement", (variant) => {
  it.each(["network", "rejected", "valid"])("renders the %s result in the production dialog", async (outcome) => {
    let resolveCheck;
    let rejectCheck;
    const fetch = vi.fn(() => new Promise((resolve, reject) => {
      resolveCheck = resolve;
      rejectCheck = reject;
    }));
    vi.stubGlobal("fetch", fetch);
    const onClose = vi.fn();
    const onCreated = vi.fn();
    await act(async () => root.render(React.createElement(AddCompatibleModal, {
      variant, isOpen: true, onClose, onCreated,
    })));
    const dialog = document.body.querySelector("dialog");
    expect(dialog.open).toBe(true);
    expect(button(dialog, "Check").disabled).toBe(true);
    expect(button(dialog, "Create").disabled).toBe(true);
    expect(dialog.querySelector('[role="alert"]')).toBeNull();
    const key = [...dialog.querySelectorAll("input")].find((input) => input.type === "password");
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(key, "fixture-key");
      key.dispatchEvent(new Event("input", { bubbles: true }));
      key.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(button(dialog, "Check").disabled).toBe(false);
    await act(async () => button(dialog, "Check").click());
    const pending = button(dialog, "Checking...");
    expect(pending.disabled).toBe(true);
    await act(async () => pending.click());
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe("/api/provider-nodes/validate");
    expect(dialog.querySelector('[role="alert"]')).toBeNull();
    await act(async () => {
      if (outcome === "network") rejectCheck(new Error("offline"));
      else resolveCheck({ json: async () => outcome === "valid"
        ? { valid: true } : { valid: false, error: "Fixture rejected" } });
    });
    expect(document.body.querySelector("dialog")).toBe(dialog);
    expect(dialog.open).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
    expect(button(dialog, "Check").disabled).toBe(false);
    if (outcome === "valid") {
      expect(dialog.textContent).toContain("Valid");
      expect(dialog.textContent).not.toContain("Invalid");
      expect(dialog.querySelector('[role="alert"]')).toBeNull();
    } else {
      const message = outcome === "network" ? "Network error" : "Fixture rejected";
      // Keep visible literals ahead of the announcement assertion for a diagnostic first red.
      expect(dialog.textContent).toContain("Invalid");
      expect(dialog.textContent).toContain(message);
      const alert = dialog.querySelector('[role="alert"]');
      expect(alert, "Check failure must request an announcement").not.toBeNull();
      expect(alert.textContent).toBe(`Invalid${message}`);
    }
  });
});
