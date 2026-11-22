// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import ProviderDetailError from "../../src/app/(dashboard)/dashboard/providers/[id]/error.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root;
let host;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  host?.remove();
  delete document.documentElement.dataset.ui;
  vi.restoreAllMocks();
});

it("announces the V5 provider error and retries", async () => {
  document.documentElement.dataset.ui = "v5";
  vi.spyOn(console, "error").mockImplementation(() => {});
  const reset = vi.fn();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(React.createElement(ProviderDetailError, { error: new Error("failed"), reset })));
  const alert = host.querySelector('[role="alert"]');
  expect(alert?.textContent).toContain("Something went wrong");
  expect(alert.querySelector('a').getAttribute('href')).toBe('/dashboard/providers');
  await act(async () => alert.querySelector('button').click());
  expect(reset).toHaveBeenCalledOnce();
});
