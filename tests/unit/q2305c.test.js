// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import CompatibleModelsSection from "../../src/app/(dashboard)/dashboard/providers/[id]/CompatibleModelsSection.js";

const directory = "../src/app/(dashboard)/dashboard/providers/[id]/";
let host, root;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  host?.remove(); root = null; host = null;
  vi.unstubAllGlobals();
});

it("uses raw fetch only for documented streaming requests", () => {
  for (const name of ["CompatibleModelsSection.js", "PassthroughModelsSection.js", "AddApiKeyModal.js"]) {
    const lines = readFileSync(directory + name, "utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes("fetch(")) expect(lines[i - 1]).toContain("SSE responses require streaming");
    }
  }
});

it("keeps model test and import failure messages", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("alert", vi.fn());
  vi.stubGlobal("fetch", vi.fn(async (url) => ({ ok: false, status: 500, json: async () => url === "/api/models/test" ? {} : { error: "Import unavailable" } })));
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  await act(async () => root.render(React.createElement(CompatibleModelsSection, {
    providerStorageAlias: "test", providerDisplayAlias: "test", modelAliases: {},
    customModels: [{ id: "model", providerAlias: "test" }], connections: [{ id: "conn", isActive: true }],
    onCopy: () => {}, onDeleteAlias: () => {}, onAddCustomModel: () => {}, onDeleteCustomModel: () => {}, onRefresh: () => {},
  })));
  await act(async () => host.querySelector('button[aria-label="Test model"]').click());
  expect(host.textContent).toContain("Inference failed in this session");
  await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent.includes("Import discovered models")).click());
  expect(alert).toHaveBeenCalledWith("Import unavailable");
});
