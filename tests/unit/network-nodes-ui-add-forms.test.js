// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import AddApiKeyModal from "@/app/(dashboard)/dashboard/providers/[id]/AddApiKeyModal.js";

let root;
let host;
const originalShowModal = HTMLDialogElement.prototype.showModal;
const originalClose = HTMLDialogElement.prototype.close;
const button = (dialog, label) => [...dialog.querySelectorAll("button")].find((node) => node.textContent.trim() === label);
const field = (dialog, label) => {
  const labelNode = [...dialog.querySelectorAll("label")].find((node) => node.textContent.trim().startsWith(label));
  return labelNode ? dialog.querySelector(`#${labelNode.htmlFor}`) : null;
};
const type = (input, value) => {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

async function render(props) {
  await act(async () => root.render(React.createElement(AddApiKeyModal, {
    isOpen: true, existingConnectionNames: [], proxyPools: [], onSave: vi.fn(), onClose: vi.fn(), ...props,
  })));
  return document.body.querySelector("dialog");
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
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

describe("add-connection flow for network nodes", () => {
  it("marks the API key optional for a compatible node and lets it be saved without one", async () => {
    const onSave = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => ({ valid: true }) })));
    const dialog = await render({ provider: "openai-compatible-lan", providerName: "LAN node", isCompatible: true, onSave });
    expect(field(dialog, "API key (optional)")).not.toBeNull();
    expect(button(dialog, "Check").disabled).toBe(false);
    expect(button(dialog, "Save").disabled).toBe(true); // name and default model still required
    await act(async () => type(field(dialog, "Default Model"), "llama3"));
    expect(button(dialog, "Save").disabled).toBe(false);
    await act(async () => button(dialog, "Save").click());
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toMatchObject({ apiKey: "", defaultModel: "llama3" });
  });

  it("keeps the key required for a regular API-key provider", async () => {
    const dialog = await render({ provider: "wafer", providerName: "Wafer", isCompatible: false });
    expect(field(dialog, "API Key")).not.toBeNull();
    expect(dialog.textContent).not.toContain("API key (optional)");
    expect(button(dialog, "Check").disabled).toBe(true);
  });

  it("asks an Ollama connection for the host base URL and saves it without a key", async () => {
    const onSave = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => ({ valid: true }) })));
    const dialog = await render({ provider: "ollama-local", providerName: "Ollama (Local)", onSave });
    const hostInput = field(dialog, "Ollama Host URL");
    expect(hostInput).not.toBeNull();
    expect(hostInput.placeholder).toBe("http://localhost:11434");
    expect(field(dialog, "API Key")).toBeNull();
    await act(async () => type(hostInput, "http://192.168.1.20:11434"));
    await act(async () => button(dialog, "Save").click());
    expect(onSave.mock.calls[0][0]).toMatchObject({ providerSpecificData: { baseUrl: "http://192.168.1.20:11434" } });
  });
});
