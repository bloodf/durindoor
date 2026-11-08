// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("@/shared/ui/components/Modal.jsx", () => ({
  default: ({ open, children }) => open ? React.createElement("section", null, children) : null,
}));
vi.mock("@/shared/ui/components/Button.jsx", () => ({
  default: ({ children, loading, ...props }) => React.createElement("button", { ...props, "aria-busy": loading || undefined }, children),
}));
vi.mock("@/shared/ui/components/Textarea.jsx", () => ({
  default: ({ label, ...props }) => React.createElement("textarea", { ...props, "aria-label": label }),
}));
vi.mock("@/i18n/runtime", () => ({ translate: (text) => text }));

import BulkImportGrokCliModal from "@/app/(dashboard)/dashboard/providers/[id]/BulkImportGrokCliModal.js";

const input = JSON.stringify({ accounts: [{ access_token: "inert-fixture" }, { name: "retry-fixture", access_token: "inert-retry-token" }] });
const partial = {
  success: 1,
  failed: 1,
  results: [{ index: 0, ok: true, id: "fixture" }, { index: 1, ok: false, error: "Temporary import failure" }],
};
const response = (data) => ({ ok: true, json: async () => data });

describe("Grok bulk import retry feedback", () => {
  let container;
  let root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("retains partial feedback and input through a failed retry until a successful response", async () => {
    const onClose = vi.fn();
    const onSuccess = vi.fn();
    let rejectRetry;
    let resolveRetry;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(partial))
      .mockImplementationOnce(() => new Promise((resolve, reject) => { rejectRetry = reject; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveRetry = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(React.createElement(BulkImportGrokCliModal, {
      isOpen: true, onClose, onSuccess,
    })));
    const textarea = container.querySelector("textarea");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(textarea, input);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const buttons = () => Array.from(container.querySelectorAll("button"));
    const submit = () => buttons()[0];
    const alerts = () => Array.from(container.querySelectorAll('[role="alert"]')).map((node) => node.textContent);

    await act(async () => submit().click());
    expect(alerts()).toContain("1 added, 1 failed");
    expect(container.textContent).toContain("[1] Temporary import failure");
    expect(onSuccess).toHaveBeenCalledTimes(1);

    await act(async () => submit().click());
    expect(alerts()).toContain("1 added, 1 failed");
    expect(textarea.disabled).toBe(true);
    expect(submit().disabled).toBe(true);
    expect(buttons()[1].disabled).toBe(true);
    await act(async () => buttons()[1].click());
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => rejectRetry(new Error("Network unavailable")));
    expect(textarea.value).toBe(input);
    expect(textarea.disabled).toBe(false);
    expect(alerts()).toEqual(["Network unavailable", "1 added, 1 failed"]);
    expect(container.textContent).toContain("[1] Temporary import failure");
    expect(onSuccess).toHaveBeenCalledTimes(1);

    await act(async () => submit().click());
    expect(alerts()).toEqual(["Network unavailable", "1 added, 1 failed"]);
    await act(async () => resolveRetry(response({ success: 2, failed: 0, results: [] })));
    expect(alerts()).toEqual([]);
    expect(container.textContent).toContain("2 added");
    expect(textarea.value).toBe(input);
    expect(onSuccess).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([, options]) => options.body)).toEqual([input, input, input]);

    await act(async () => buttons()[1].click());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(textarea.value).toBe("");
    expect(container.textContent).not.toContain("2 added");
  });
});
