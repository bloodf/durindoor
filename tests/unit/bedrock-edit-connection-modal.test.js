// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const h = React.createElement;
vi.mock("@/shared/ui/components/Modal.jsx", () => ({
  default: ({ open, children, footer }) => (open ? h("section", null, children, footer) : null),
}));
vi.mock("@/shared/ui/components/Button.jsx", () => ({
  default: ({ children, onClick, disabled }) => h("button", { onClick, disabled }, children),
}));
vi.mock("@/shared/ui/components/Input.jsx", () => ({
  default: ({ label, value, onChange }) => h("label", null, label, h("input", { value, onChange })),
}));
vi.mock("@/shared/ui/components/Badge.jsx", () => ({ Badge: ({ children }) => h("span", null, children) }));
vi.mock("@/shared/ui/components/Field.jsx", () => ({ default: ({ children }) => h("div", null, children) }));
vi.mock("@/shared/ui/components/Toggle.jsx", () => ({ default: () => null }));
vi.mock("@/shared/ui/components/Select.jsx", () => ({ default: () => null }));

import EditConnectionModal from "@/shared/components/EditConnectionModal.js";

const connection = {
  id: "c1",
  provider: "bedrock",
  authType: "apikey",
  name: "sso",
  priority: 1,
  providerSpecificData: { region: "us-east-1", profile: "old-sso" },
};

describe("EditConnectionModal AWS credential checks", () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  const inputFor = (label) =>
    Array.from(container.querySelectorAll("label")).find((node) => node.textContent.startsWith(label)).querySelector("input");
  const type = async (label, value) => {
    const input = inputFor(label);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  const click = async (text) => {
    const button = Array.from(container.querySelectorAll("button")).find((node) => node.textContent === text);
    await act(async () => { button.click(); });
  };

  it("does not reuse a passed Check after the key changes, so a failing new key is not saved", async () => {
    const results = [true, false];
    globalThis.fetch = vi.fn(async () => ({ json: async () => ({ valid: results.shift() }) }));
    const onSave = vi.fn();
    await act(async () => {
      root.render(h(EditConnectionModal, { isOpen: true, connection, proxyPools: [], onSave, onClose: vi.fn() }));
    });

    await type("API Key", "good-key");
    await click("Check");
    await type("API Key", "bad-paste");
    await click("Save");

    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(onSave).not.toHaveBeenCalled();
  });
});
