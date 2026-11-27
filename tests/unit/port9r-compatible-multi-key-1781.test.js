// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import path from "node:path";
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
const setValue = (element, value) => {
  const proto = element.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
};

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

describe("upstream #1781 OpenAI-compatible multi-key UI", () => {
  it("requires and sends defaultModel for every key in compatible bulk imports", async () => {
    const fetchMock = vi.fn(async (url, init) => {
      if (!init?.method || init.method === "GET") {
        return { ok: true, json: async () => ({ connections: [] }) };
      }
      return { ok: true, json: async () => ({ connection: { id: "conn-1" } }) };
    });
    vi.stubGlobal("fetch", fetchMock);
    const onBulkDone = vi.fn();

    await act(async () => root.render(React.createElement(AddApiKeyModal, {
      isOpen: true,
      provider: "openai-compatible-chat-multi",
      providerName: "Multi Key Node",
      isCompatible: true,
      isAnthropic: false,
      existingConnectionNames: [],
      proxyPools: [],
      onSave: vi.fn(),
      onBulkDone,
      onClose: vi.fn(),
    })));
    const dialog = document.body.querySelector("dialog");

    await act(async () => button(dialog, "Bulk Add").click());
    expect(field(dialog, "Default Model")).not.toBeNull();
    expect(button(dialog, "Add All Keys").disabled).toBe(true);

    await act(async () => setValue(field(dialog, "Credentials"), "Primary|sk-one\nBackup|sk-two"));
    expect(button(dialog, "Add All Keys").disabled).toBe(true);

    await act(async () => setValue(field(dialog, "Default Model"), "  gpt-4o-mini  "));
    expect(button(dialog, "Add All Keys").disabled).toBe(false);

    await act(async () => button(dialog, "Add All Keys").click());

    const posts = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posts).toHaveLength(2);
    expect(posts.map(([, init]) => JSON.parse(init.body))).toEqual([
      expect.objectContaining({
        provider: "openai-compatible-chat-multi",
        name: "Primary 1",
        apiKey: "sk-one",
        defaultModel: "gpt-4o-mini",
        createOnly: true,
      }),
      expect.objectContaining({
        provider: "openai-compatible-chat-multi",
        name: "Backup 1",
        apiKey: "sk-two",
        defaultModel: "gpt-4o-mini",
        createOnly: true,
      }),
    ]);
    expect(onBulkDone).toHaveBeenCalledTimes(1);
  });

  it("exposes post-first-connection add controls for OpenAI-compatible nodes while keeping Anthropic-compatible gated", () => {
    const source = readFileSync(
      path.resolve(process.cwd(), "../src/app/(dashboard)/dashboard/providers/[id]/sections/ProviderDetailSections.jsx"),
      "utf8",
    );
    expect(source).toContain("const canAddConnectionAfterFirst = !isCompatible || !isAnthropicCompatible;");
    expect(source).toContain("{canAddConnectionAfterFirst &&");
  });
});
