// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import EditCompatibleNodeModal from "../../src/app/(dashboard)/dashboard/providers/[id]/EditCompatibleNodeModal.js";
import { updateCompatibleProviderNode } from "../../src/app/(dashboard)/dashboard/providers/[id]/updateCompatibleProviderNode.js";

let root;
let container;
let originalActEnvironment;
const button = (text) => Array.from(document.querySelectorAll("button")).find((el) => el.textContent.trim() === text);

beforeEach(() => {
  originalActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  // Only emulate native dialog opening; production Modal owns dismissal logic.
  vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function () { this.setAttribute("open", ""); });
  vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function () { this.removeAttribute("open"); });
  vi.stubGlobal("fetch", vi.fn());
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  globalThis.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment;
});

it("guards pending dismissal, preserves edited fields after generic PUT failure, and permits retry", async () => {
  let finish;
  fetch.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ node: { id: "fixture-node" } }) });
  const onClose = vi.fn();
  const onSuccess = vi.fn();
  await act(async () => root.render(React.createElement(EditCompatibleNodeModal, {
    isOpen: true,
    node: { id: "fixture-node", name: "Original", prefix: "original", baseUrl: "https://original.invalid/v1" },
    onClose,
    onSave: (formData) => updateCompatibleProviderNode({ providerId: "fixture-node", formData, onSuccess }),
    isAnthropic: false,
  })));
  const edited = ["Edited node", "edited", "https://edited.invalid/v1", "https://edited.invalid/icon.png"];
  const inputs = Array.from(document.querySelectorAll("input")).slice(0, 4);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  for (const [index, input] of inputs.entries()) {
    await act(async () => {
      setter.call(input, edited[index]);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  await act(async () => button("Save").click());
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][0]).toBe("/api/provider-nodes/fixture-node");
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
    name: "Edited node", prefix: "edited", baseUrl: "https://edited.invalid/v1",
    iconUrl: "https://edited.invalid/icon.png", apiType: "chat",
  });
  expect(button("Cancel").disabled).toBe(true);
  const dialog = document.querySelector("dialog");
  await act(async () => {
    button("Cancel").click();
    document.querySelector('button[aria-label="Close"]').click();
    dialog.dispatchEvent(new Event("cancel", { bubbles: true, cancelable: true }));
    dialog.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    dialog.dispatchEvent(new Event("pointerup", { bubbles: true }));
  });
  expect(onClose).not.toHaveBeenCalled();
  await act(async () => finish({ ok: false, json: async () => ({}) }));
  expect(document.querySelector('[role="alert"]').textContent).toContain("Failed to update provider node");
  expect(inputs.map((input) => input.value)).toEqual(edited);
  expect(dialog.open).toBe(true);
  expect(onSuccess).not.toHaveBeenCalled();
  expect(button("Save").disabled).toBe(false);
  expect(button("Cancel").disabled).toBe(false);
  await act(async () => button("Save").click());
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[1][1].body).toBe(fetch.mock.calls[0][1].body);
  expect(document.querySelector('[role="alert"]')).toBeNull();
  expect(onSuccess).toHaveBeenCalledWith({ id: "fixture-node" });
  await act(async () => button("Cancel").click());
  expect(onClose).toHaveBeenCalledTimes(1);
});
