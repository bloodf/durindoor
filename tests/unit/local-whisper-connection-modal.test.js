// @vitest-environment happy-dom
/**
 * The Local Whisper runtime resolves its endpoint from
 * `providerSpecificData.baseUrl`, but only the connection dialog ever writes
 * that value. Without this guard the host field could render and still save
 * nothing — the resolver would silently fall back to the default host and the
 * URL the user typed would be ignored.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/shared/ui/components/Modal.jsx", () => ({
  default: ({ open, title, children, footer }) => open ? React.createElement("section", null,
    React.createElement("h2", null, title), children, footer) : null,
}));
vi.mock("@/shared/ui/components/Button.jsx", () => ({
  default: ({ children, loading, ...props }) => React.createElement("button", { ...props, "aria-busy": loading || undefined }, children),
}));
vi.mock("@/shared/ui/components/Textarea.jsx", () => ({
  default: (props) => React.createElement("textarea", props),
}));
vi.mock("@/i18n/runtime", () => ({ translate: (text) => text }));

import AddApiKeyModal from "@/app/(dashboard)/dashboard/providers/[id]/AddApiKeyModal.js";

function labelledInput(container, labelText) {
  const label = [...container.querySelectorAll("label")].find(
    (node) => node.textContent.trim() === labelText,
  );
  if (!label) return null;
  return label.control
    || container.querySelector(`#${label.getAttribute("for")}`)
    || label.parentElement?.querySelector("input");
}

function setInputValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  ).set;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("AddApiKeyModal — Local Whisper host persistence", () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    // handleSubmit probes /api/providers/validate before calling onSave.
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ valid: true }),
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  const render = async (provider, onSave) => {
    await act(async () => {
      root.render(React.createElement(AddApiKeyModal, {
        isOpen: true,
        provider,
        providerName: provider,
        existingConnectionNames: [],
        onSave,
        onClose: vi.fn(),
        onBulkDone: vi.fn(),
      }));
    });
  };

  it("offers a Whisper-specific host field", async () => {
    await render("local-whisper", vi.fn());
    expect(labelledInput(container, "Whisper Server URL")).not.toBeNull();
    // The Ollama wording must not leak into the Whisper dialog.
    expect(labelledInput(container, "Ollama Host URL")).toBeNull();
  });
  it("saves the typed host as providerSpecificData.baseUrl", async () => {
    const onSave = vi.fn();
    await render("local-whisper", onSave);

    const hostInput = labelledInput(container, "Whisper Server URL");
    await act(async () => setInputValue(hostInput, "http://192.168.1.50:9000"));

    const save = [...container.querySelectorAll("button")].find(
      (node) => node.textContent.trim() === "Save",
    );
    // A keyless provider has no API key to type, so Save must not stay disabled
    // waiting for one — otherwise the connection can never be created.
    expect(save.disabled).toBe(false);

    await act(async () => save.click());

    expect(onSave).toHaveBeenCalledTimes(1);
    // Keyless: the payload carries an empty apiKey and the typed host.
    expect(onSave.mock.calls[0][0]).toMatchObject({
      apiKey: "",
      providerSpecificData: { baseUrl: "http://192.168.1.50:9000" },
    });
  });

  it("submits without the user typing a name or key", async () => {
    // The dialog pre-fills a connection name, and a keyless provider has no key
    // to enter, so an untouched form must still be submittable.
    const onSave = vi.fn();
    await render("local-whisper", onSave);
    const save = [...container.querySelectorAll("button")].find(
      (node) => node.textContent.trim() === "Save",
    );
    await act(async () => save.click());
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0].name).toBeTruthy();
    expect(onSave.mock.calls[0][0].apiKey).toBe("");
  });
  it("still offers the Ollama host field for ollama-local", async () => {
    await render("ollama-local", vi.fn());
    expect(labelledInput(container, "Ollama Host URL")).not.toBeNull();
  });

  it("offers no host field for a cloud provider", async () => {
    await render("groq", vi.fn());
    expect(labelledInput(container, "Whisper Server URL")).toBeNull();
    expect(labelledInput(container, "Ollama Host URL")).toBeNull();
  });
});
