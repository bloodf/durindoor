// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import AutoPingScheduleModal from "@/app/(dashboard)/dashboard/providers/[id]/AutoPingScheduleModal.js";

let root;
let host;
const originalShowModal = HTMLDialogElement.prototype.showModal;
const originalClose = HTMLDialogElement.prototype.close;
const button = (label) => [...document.querySelectorAll("button")]
  .find((node) => node.textContent.trim() === label);

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  // DOM shim only; native top-layer behavior needs a browser gate.
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
});

it.each(["Cancel", "Close", "Escape", "backdrop"])(
  "blocks %s during save, retains edits after failure, and restores dismissal",
  async (dismissal) => {
    let rejectSave;
    const onSave = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve, reject) => { rejectSave = reject; }))
      .mockResolvedValueOnce(undefined);
    const onClose = vi.fn();
    // Mirrors the production caller's conditional mount and close callback.
    function Caller() {
      const [selected, setSelected] = useState(true);
      return selected ? React.createElement(AutoPingScheduleModal, {
        isOpen: true,
        connection: { name: "Fixture" },
        schedule: { enabled: true, anchor: "09:30", timezone: "UTC", windowHours: 5, slotsPerDay: 3 },
        onSave,
        onClose: () => { onClose(); setSelected(false); },
      }) : null;
    }
    await act(async () => root.render(React.createElement(Caller)));
    const dialog = document.querySelector("dialog");
    const anchor = dialog.querySelector('input[type="time"]');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(anchor, "10:30");
      anchor.dispatchEvent(new Event("input", { bubbles: true }));
      anchor.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => button("Save").click());
    expect(onSave).toHaveBeenCalledExactlyOnceWith({
      enabled: true, anchor: "10:30", timezone: "UTC", windowHours: 5, slotsPerDay: 3,
    });
    expect(button("Saving...").disabled).toBe(true);
    expect(button("Cancel").disabled).toBe(true);
    expect(dialog.querySelector('[aria-label="Close"]').disabled).toBe(true);
    const dismiss = () => {
      if (dismissal === "Cancel") button("Cancel").click();
      if (dismissal === "Close") dialog.querySelector('[aria-label="Close"]').click();
      if (dismissal === "Escape") dialog.dispatchEvent(new Event("cancel", { bubbles: true, cancelable: true }));
      if (dismissal === "backdrop") {
        dialog.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
        dialog.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
      }
    };
    await act(async () => dismiss());
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => rejectSave(new Error("Schedule save failed")));
    expect(document.querySelector("dialog")).toBe(dialog);
    expect(dialog.querySelector('[role="alert"]').textContent).toContain("Schedule save failed");
    expect(anchor.value).toBe("10:30");
    expect(button("Save").disabled).toBe(false);
    expect(button("Cancel").disabled).toBe(false);
    expect(dialog.querySelector('[aria-label="Close"]').disabled).toBe(false);
    if (dismissal === "Cancel") {
      await act(async () => button("Save").click());
      expect(onSave).toHaveBeenCalledTimes(2);
      expect(onSave.mock.calls[1][0]).toEqual({
        enabled: true, anchor: "10:30", timezone: "UTC", windowHours: 5, slotsPerDay: 3,
      });
    } else {
      await act(async () => dismiss());
    }
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.querySelector("dialog")).toBeNull();
  },
);
