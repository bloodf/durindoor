// @vitest-environment happy-dom
/**
 * Regression for a ReferenceError that crashed the whole API Keys page.
 *
 * `newKeyAllowedCombos` (and its setter) is read/written in the Add Key
 * modal's combo checklist, but the useState declaration for it was dropped
 * in the key-groups commit (14bf06d3) while every read/write site stayed.
 * Every other test in this suite renders with `combos: []`, so the branch
 * that reads `newKeyAllowedCombos` (`combos.length > 0`) never ran and the
 * bug shipped unnoticed. This test renders with at least one combo so that
 * branch executes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/shared/ui/components/Card.jsx", () => ({
  Card: ({ children }) => React.createElement("section", null, children),
  CardHeader: ({ title, subtitle, actions }) => React.createElement("header", null, title, subtitle, actions),
  CardContent: ({ children }) => React.createElement("div", null, children),
}));
vi.mock("@/shared/ui/components/Button.jsx", () => ({
  default: ({ children, icon, ...props }) => React.createElement("button", props, children),
}));
vi.mock("@/shared/ui/components/IconButton.jsx", () => ({
  default: ({ label, icon, ...props }) => React.createElement("button", { ...props, "aria-label": label }, label),
}));
vi.mock("@/shared/ui/components/PageHeader.jsx", () => ({ default: ({ title }) => React.createElement("h1", null, title) }));
vi.mock("@/shared/ui/components/Badge.jsx", () => ({ Badge: ({ children }) => React.createElement("span", null, children) }));
vi.mock("@/shared/ui/components/EmptyState.jsx", () => ({ default: ({ title }) => React.createElement("p", null, title) }));
vi.mock("@/shared/ui/components/Input.jsx", () => ({
  default: ({ label, ...props }) => React.createElement("input", { ...props, "aria-label": label }),
}));
vi.mock("@/shared/ui/components/Field.jsx", () => ({
  default: ({ label, children }) => React.createElement("label", null, label, children),
}));
vi.mock("@/shared/ui/components/Select.jsx", () => ({ default: () => null }));
vi.mock("@/shared/ui/components/DataTable.jsx", () => ({ default: () => null }));
vi.mock("@/shared/ui/components/Checkbox.jsx", () => ({
  default: ({ checked, onChange, label }) =>
    React.createElement(
      "label",
      null,
      React.createElement("input", {
        type: "checkbox",
        checked: !!checked,
        "aria-label": label,
        onChange: () => onChange?.(!checked),
      }),
      label,
    ),
}));
vi.mock("@/shared/ui/components/Toggle.jsx", () => ({
  default: ({ checked, onChange, ...props }) => React.createElement("button", { ...props, role: "switch", "aria-checked": String(checked), onClick: () => onChange?.(!checked) }),
}));
vi.mock("@/shared/ui/components/Modal.jsx", () => ({
  default: ({ open, title, children, footer }) => open ? React.createElement("dialog", { open: true, "aria-label": title }, children, footer) : null,
}));
vi.mock("@/shared/ui/components/SegmentedControl.jsx", () => ({ default: () => null }));

import KeysPageClient from "@/app/(dashboard)/dashboard/keys/KeysPageClient.jsx";

const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

const baseKeys = [
  { id: "k1", name: "ci-deploy", maskedKey: "sk-••••••••", isActive: true, createdAt: "2026-01-01T00:00:00Z", groupIds: [], usage: {}, allowedCombos: [], providerConnectionIds: [] },
];
const baseCombos = [{ id: "c1", name: "fast", kind: "chat" }];

describe("API Keys page — Add Key modal with combos configured", () => {
  let container;
  let root;
  let calls;

  beforeEach(() => {
    calls = [];
    globalThis.fetch = vi.fn((url, options = {}) => {
      const target = String(url);
      calls.push({ url: target, method: options.method || "GET", body: options.body ? JSON.parse(options.body) : null });
      if (target === "/api/keys" && (options.method || "GET") === "GET") {
        return Promise.resolve(response({ keys: baseKeys, groups: [], providerConnections: [] }));
      }
      if (target === "/api/combos") return Promise.resolve(response({ combos: baseCombos }));
      if (target.startsWith("/api/keys/policy-catalog")) return Promise.resolve(response({ models: [] }));
      if (target === "/api/keys" && options.method === "POST") {
        return Promise.resolve(response({ key: "sk-new", name: JSON.parse(options.body).name, id: "k2", allowedCombos: JSON.parse(options.body).allowedCombos, expiresAt: null }, 201));
      }
      return Promise.resolve(response({}));
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  const render = async () => {
    await act(async () => {
      root.render(React.createElement(KeysPageClient));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  const buttons = () => Array.from(container.querySelectorAll("button"));
  const byText = (text) => buttons().find((node) => node.textContent.trim() === text);

  it("opens the Add Key modal without crashing when combos exist", async () => {
    await render();

    // Before the fix, opening this modal threw
    // "ReferenceError: newKeyAllowedCombos is not defined" because the combo
    // checklist below reads it while combos.length > 0, and React unmounted
    // the whole page.
    await act(async () => byText("Create Key").click());

    const dialog = container.querySelector('dialog[aria-label="Create API Key"]');
    expect(dialog).not.toBeNull();
    expect(dialog.textContent).toContain("All combos");
    expect(dialog.textContent).toContain("fast");
  });

  it("submits the selected combo in allowedCombos", async () => {
    await render();
    await act(async () => byText("Create Key").click());

    const nameInput = container.querySelector('input[aria-label="Key Name"]');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(globalThis.HTMLInputElement.prototype, "value").set;
      setter.call(nameInput, "combo-scoped");
      nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const comboCheckbox = container.querySelector('input[aria-label="fast"]');
    await act(async () => comboCheckbox.click());

    const create = buttons().find((node) => node.textContent.trim() === "Create" && node.closest("dialog"));
    await act(async () => create.click());

    const post = calls.find((call) => call.url === "/api/keys" && call.method === "POST");
    expect(post).toBeDefined();
    expect(post.body.allowedCombos).toEqual(["fast"]);
  });
});
