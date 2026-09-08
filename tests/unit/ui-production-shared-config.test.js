// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

import EditConnectionModal from "@/shared/components/EditConnectionModal.js";
import AddCustomEmbeddingModal from "@/shared/components/AddCustomEmbeddingModal.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const h = React.createElement;
const roots = [];
const originalShowModal = HTMLDialogElement.prototype.showModal;
const originalClose = HTMLDialogElement.prototype.close;

function render(element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push([root, container]);
  act(() => root.render(element));
}

async function flush() {
  await act(async () => { await Promise.resolve(); });
}

function inputByLabel(label) {
  const node = [...document.querySelectorAll("label")].find((el) => el.textContent.replace(/\s*\*\s*$/, "").trim() === label);
  return node ? document.getElementById(node.htmlFor) : null;
}

function setValue(input, value) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function shimShowModal() {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function shimClose() {
    this.removeAttribute("open");
  };
  globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ error: "Save failed" }), { status: 500 }));
});

afterEach(() => {
  while (roots.length) {
    const [root, container] = roots.pop();
    act(() => root.unmount());
    container.remove();
  }
  HTMLDialogElement.prototype.showModal = originalShowModal;
  HTMLDialogElement.prototype.close = originalClose;
  document.body.innerHTML = "";
});

describe("shared configuration modal behavior", () => {
  it("blocks account-scoped saves until Account ID is present", async () => {
    const onSave = vi.fn();
    render(h(EditConnectionModal, {
      isOpen: true,
      onClose: vi.fn(),
      onSave,
      connection: { id: "cf-1", name: "Cloudflare", provider: "cloudflare-ai", providerSpecificData: {} },
    }));
    await flush();
    const save = [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Save");
    expect(save.disabled).toBe(true);
    const accountId = inputByLabel("Account ID");
    expect(accountId).not.toBeNull();
    setValue(accountId, "account-123");
    expect(save.disabled).toBe(false);
  });

  it("does not report creation after server rejects custom embedding save", async () => {
    const onCreated = vi.fn();
    render(h(AddCustomEmbeddingModal, { isOpen: true, onClose: vi.fn(), onCreated }));
    await flush();
    setValue(inputByLabel("Name"), "Voyage");
    setValue(inputByLabel("Prefix"), "voyage");
    await act(async () => [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Create").click());
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/provider-nodes", expect.objectContaining({ method: "POST" }));
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("dismisses edit modal through its close control", async () => {
    const onClose = vi.fn();
    render(h(EditConnectionModal, {
      isOpen: true,
      onClose,
      onSave: vi.fn(),
      connection: { id: "openai-1", name: "OpenAI", provider: "openai", providerSpecificData: {} },
    }));
    await flush();
    await act(async () => document.querySelector("dialog[open] button[aria-label='Close']").click());
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
