// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { ReadableStream } from "node:stream/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CompatibleModelsSection from "../../src/app/(dashboard)/dashboard/providers/[id]/CompatibleModelsSection.js";

let host, root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const click = async (element) => {
  expect(element).toBeTruthy();
  await act(async () => { element.click(); });
};
const statusFor = (id) => host.querySelector(`input[aria-label="Select ${id}"]`)
  .closest("label").parentElement.querySelector('[role="status"]').textContent;

// Synthetic SSE exercises production UI attribution, not live provider inference.
describe("compatible model batch identity", () => {
  it.each([
    ["test", [{ model: "test/org/model", ok: true }], "Inference passed in this session"],
    ["team/provider", [{ model: "team/provider/org/model", ok: true }], "Inference passed in this session"],
    ["test", [
      { model: "other/org/model", ok: true },
      { model: "test/model", ok: true },
      { model: "org/model", ok: true },
    ], "Inference not tested"],
    ["test", [{ model: "test/org/model", ok: true, skipped: true }], "Inference skipped in this session"],
  ])("attributes only selected outbound IDs for %s (%j)", async (providerAlias, events, expectedStatus) => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      body: new ReadableStream({
        start(controller) {
          const data = [...events, { done: true }]
            .map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
          controller.enqueue(new TextEncoder().encode(data));
          controller.close();
        },
      }),
    })));
    await act(async () => {
      root.render(React.createElement(CompatibleModelsSection, {
        providerStorageAlias: providerAlias, providerDisplayAlias: providerAlias,
        modelAliases: {}, customModels: ["org/model", "model"].map((id) => ({ id, providerAlias })),
        connections: [{ id: "connection", isActive: true }], copied: "",
        onCopy: () => {}, onDeleteAlias: () => {}, onAddCustomModel: () => {},
        onDeleteCustomModel: () => {}, onRefresh: () => {},
      }));
    });
    expect(statusFor("org/model")).toBe("Inference not tested");
    expect(statusFor("model")).toBe("Inference not tested");
    expect(fetch).not.toHaveBeenCalled();
    await click(host.querySelector('input[aria-label="Select org/model"]'));
    await click([...host.querySelectorAll("button")]
      .find((button) => button.textContent.includes("Test Selected (1)")));

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe("/api/models/test/batch");
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body)).toEqual({
      models: [{ model: `${providerAlias}/org/model`, kind: "llm" }], connectionId: "connection",
    });
    expect(statusFor("org/model")).toBe(expectedStatus);
    expect(statusFor("model")).toBe("Inference not tested");
  });
});
