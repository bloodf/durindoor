// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import NetworkNodeStatus from "@/app/(dashboard)/dashboard/providers/[id]/NetworkNodeStatus.js";

const files = ["ModelAutoSyncPanel.js", "FireflyBrowserPanel.jsx", "VisibleModelsModal.js", "NetworkNodeStatus.js", "SyncProviderModelsModal.jsx", "OpenRouterRoutingCard.js", "CookieImportModal.js"];

it("routes provider page requests through the client", () => {
  for (const file of files) {
    const source = readFileSync(`../src/app/(dashboard)/dashboard/providers/[id]/${file}`, "utf8");
    expect(source).not.toMatch(/\bfetch\s*\(/);
  }
});

let root;
let host;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  host?.remove();
  vi.unstubAllGlobals();
});

it("keeps the model and health HTTP failure messages", async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("fetch", vi.fn(async (url) => ({
    ok: false, status: String(url).includes("health") ? 502 : 503,
    json: async () => ({}),
  })));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(React.createElement(NetworkNodeStatus, { connection: { id: "c1", name: "Node", provider: "ollama" } })));
  expect(host.textContent).toContain("Could not load models (HTTP 503)");
  expect(host.textContent).toContain("Could not load health (HTTP 502)");
});
