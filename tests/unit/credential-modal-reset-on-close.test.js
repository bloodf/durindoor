// @vitest-environment happy-dom
/**
 * A credential typed into an auth modal must not survive the modal closing.
 *
 * Both modals below kept their token/key fields in component state with no
 * reset, so cancelling left the secret populated and it was still rendered in
 * the form the next time the modal was opened — visible to anyone who reopens
 * it, and carried across into an unrelated connection attempt.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

import CursorAuthModal from "@/shared/components/CursorAuthModal.js";
import KiroAuthModal from "@/shared/components/KiroAuthModal.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  // Both modals probe an auto-import endpoint when they open.
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: false,
    json: async () => ({}),
    text: async () => "",
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

const render = async (element) => act(async () => root.render(element));

/** Type into a rendered input the way a user would. */
async function typeInto(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

// Modal renders through createPortal into document.body, so the mount container
// stays empty — query the document.
const inputs = () => Array.from(document.querySelectorAll("input"));
const values = () => inputs().map((node) => node.value);
const markup = () => document.body.innerHTML;

describe("credential modals reset on close", () => {
  it("clears the Cursor access token and machine ID when the modal closes", async () => {
    const onClose = vi.fn();
    await render(React.createElement(CursorAuthModal, { isOpen: true, onSuccess: vi.fn(), onClose }));

    const textFields = inputs().filter((node) => node.type === "text" || node.type === "password" || !node.type);
    expect(textFields.length).toBeGreaterThan(0);
    await typeInto(textFields[0], "cursor-secret-token");
    expect(values()).toContain("cursor-secret-token");

    // Close, then reopen — the secret must be gone, not merely hidden.
    await render(React.createElement(CursorAuthModal, { isOpen: false, onSuccess: vi.fn(), onClose }));
    await render(React.createElement(CursorAuthModal, { isOpen: true, onSuccess: vi.fn(), onClose }));

    expect(values()).not.toContain("cursor-secret-token");
    expect(markup()).not.toContain("cursor-secret-token");
  });

  it("clears the Kiro credential fields when the modal closes", async () => {
    const onClose = vi.fn();
    const props = { isOpen: true, onMethodSelect: vi.fn(), onClose };
    await render(React.createElement(KiroAuthModal, props));

    // Reach the API-key method so its credential field renders.
    const apiKeyButton = Array.from(document.querySelectorAll("button"))
      .find((node) => /api key/i.test(node.textContent || ""));
    if (apiKeyButton) {
      await act(async () => apiKeyButton.click());
    }

    const field = inputs().find((node) => node.type !== "radio" && node.type !== "checkbox");
    expect(field).toBeDefined();
    await typeInto(field, "kiro-secret-key");
    expect(markup()).toContain("kiro-secret-key");

    await render(React.createElement(KiroAuthModal, { ...props, isOpen: false }));
    await render(React.createElement(KiroAuthModal, props));

    expect(markup()).not.toContain("kiro-secret-key");
  });
});
