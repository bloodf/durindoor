// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import CustomModelModal from "@/app/(dashboard)/dashboard/providers/[id]/AddCustomModelModal.js";

vi.mock("@/shared/ui/components/Select.jsx", () => ({
  default: ({ options, value, onChange, "aria-label": label }) => React.createElement(
    "select", { value, "aria-label": label, onChange: (event) => onChange(event.target.value) },
    options.map((item) => React.createElement("option", { value: item.value, key: item.value }, item.label))
  )
}));

let root;
let host;

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  host?.remove();
  vi.unstubAllGlobals();
});

describe("custom model type", () => {
  it("uses the same selected modality for probing and saving", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const probe = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal("fetch", probe);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    const save = vi.fn();
    await act(async () => root.render(React.createElement(CustomModelModal, {
      isOpen: true, providerAlias: "fixture", onClose: vi.fn(), onSave: save
    })));
    const input = document.querySelector("#custom-model-id");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "speech-model");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const modality = document.querySelector('select[aria-label="Model type"]');
    expect(modality.value).toBe("llm");
    await act(async () => {
      modality.value = "stt";
      modality.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const findButton = (label) => [...document.querySelectorAll("button")].find((button) => button.textContent.trim().endsWith(label));
    await act(async () => findButton("Test").click());
    expect(probe).toHaveBeenCalledWith("/api/models/test", expect.objectContaining({
      body: JSON.stringify({ model: "fixture/speech-model", kind: "stt" })
    }));
    await act(async () => findButton("Add Model").click());
    expect(save).toHaveBeenCalledWith({ id: "speech-model", type: "stt", capabilities: undefined });
  });
});
