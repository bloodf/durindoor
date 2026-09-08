// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/shared/ui/components/Modal.jsx", () => ({
  default: ({ open, children, title }) =>
    open ? React.createElement("section", { "data-modal": title }, children) : null,
}));
vi.mock("@/shared/ui/components/Button.jsx", () => ({
  default: ({ children, ...rest }) => React.createElement("button", rest, children),
}));
vi.mock("@/shared/ui/components/Input.jsx", () => ({
  default: ({ label, error, hint, ...rest }) =>
    React.createElement(
      "label",
      null,
      label ? React.createElement("span", null, label) : null,
      React.createElement("input", { "aria-invalid": Boolean(error), ...rest }),
      error ? React.createElement("p", { role: "alert" }, error) : hint ? React.createElement("p", null, hint) : null,
    ),
}));
vi.mock("@/shared/ui/components/Textarea.jsx", () => ({
  default: ({ label, error, hint, ...rest }) =>
    React.createElement(
      "label",
      null,
      label ? React.createElement("span", null, label) : null,
      React.createElement("textarea", { "aria-invalid": Boolean(error), ...rest }),
      error ? React.createElement("p", { role: "alert" }, error) : hint ? React.createElement("p", null, hint) : null,
    ),
}));
vi.mock("@/shared/ui/components/Select.jsx", () => ({
  default: ({ options = [], value, onChange, ...rest }) =>
    React.createElement(
      "select",
      { value: value ?? "", onChange: (event) => onChange?.(event.target.value), ...rest },
      options.map((option) => React.createElement("option", { key: option.value, value: option.value }, option.label)),
    ),
}));

import KiroAuthModal from "@/shared/components/KiroAuthModal.js";
import CursorAuthModal from "@/shared/components/CursorAuthModal.js";
import KiroOAuthWrapper from "@/shared/components/KiroOAuthWrapper.js";

function render(element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(element);
  });
  return { container, root };
}

function unmount(root, container) {
  act(() => {
    root.unmount();
  });
  container.remove();
}

beforeEach(() => {
  globalThis.fetch = vi.fn(() => Promise.resolve({ ok: true, json: async () => ({ found: false }) }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Production/shared-kiro public API", () => {
  it("KiroAuthModal renders the method-selection grid when opened", () => {
    const onMethodSelect = vi.fn();
    const onClose = vi.fn();
    const { container, root } = render(
      React.createElement(KiroAuthModal, { isOpen: true, onMethodSelect, onClose }),
    );
    const buttons = container.querySelectorAll("button");
    const labels = Array.from(buttons).map((button) => button.textContent || "");
    expect(labels.some((label) => /aws builder id/i.test(label))).toBe(true);
    expect(labels.some((label) => /api key/i.test(label))).toBe(true);
    expect(labels.some((label) => /import token/i.test(label))).toBe(true);
    unmount(root, container);
  });

  it("KiroAuthModal surfaces an inline error for the import method when auto-detect fails", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: async () => ({ found: false, error: "Kiro IDE not found" }) }),
    );
    const onMethodSelect = vi.fn();
    const onClose = vi.fn();
    const { container, root } = render(
      React.createElement(KiroAuthModal, { isOpen: true, onMethodSelect, onClose }),
    );
    await act(async () => {
      const importButton = Array.from(container.querySelectorAll("button")).find((button) => /import token/i.test(button.textContent || ""));
      importButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent || "").toMatch(/kiro ide not found/i);
    unmount(root, container);
  });

  it("CursorAuthModal renders an auto-detected notice when fetch returns found", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: async () => ({ found: true, accessToken: "tok", machineId: "m1" }) }),
    );
    const onSuccess = vi.fn();
    const onClose = vi.fn();
    const { container, root } = render(
      React.createElement(CursorAuthModal, { isOpen: true, onSuccess, onClose }),
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent || "").toMatch(/auto-detected from cursor ide successfully/i);
    unmount(root, container);
  });

  it("KiroOAuthWrapper treats the CLIProxyAPI import as a successful connection", async () => {
    const onSuccess = vi.fn();
    const onClose = vi.fn();
    const { container, root } = render(
      React.createElement(KiroOAuthWrapper, {
        isOpen: true,
        onSuccess,
        onClose,
        proxyPools: [],
        proxyPoolsReady: true,
      }),
    );
    act(() => {
      const cliProxy = Array.from(container.querySelectorAll("button")).find((button) => /cliproxyapi/i.test(button.textContent || ""));
      cliProxy?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      const textarea = container.querySelector("textarea");
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(textarea, '{"auth_method":"external_idp"}');
      textarea?.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });
    await act(async () => {
      const importButton = Array.from(container.querySelectorAll("button")).find((button) => /^import cliproxyapi json/i.test((button.textContent || "").trim()));
      importButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onSuccess).toHaveBeenCalledOnce();
    unmount(root, container);
  });
});
