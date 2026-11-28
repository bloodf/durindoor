// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { URL as NodeURL } from "node:url";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import LanDiscoveryPanel from "../../src/app/(dashboard)/dashboard/providers/components/LanDiscoveryPanel.js";

const files = [
  "components/ConnectionsCard.js",
  "components/LanDiscoveryPanel.js",
  "components/AddCompatibleModal.js",
  "[id]/ReadinessEvidence.jsx",
];
let host, root;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it("routes provider page requests through the client", () => {
  for (const file of files) {
    const source = readFileSync(new NodeURL(`../../src/app/(dashboard)/dashboard/providers/${file}`, import.meta.url), "utf8");
    expect(source).not.toMatch(/\bfetch\s*\(/);
  }
});

it.each([
  [{ error: "CIDR range too large" }, "CIDR range too large"],
  [{}, "Discovery failed (HTTP 500)"],
])("preserves discovery failure text", async (body, expected) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => body }));
  await act(async () => root.render(React.createElement(LanDiscoveryPanel)));
  const input = host.querySelector("input");
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, "10.0.0.1");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent.trim() === "Discover").click());
  expect(host.querySelector('[role="alert"]').textContent).toBe(expected);
});
