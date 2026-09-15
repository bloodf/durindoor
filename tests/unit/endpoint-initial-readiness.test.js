// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { within } from "@testing-library/dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import KeysPage from "../../src/app/(dashboard)/dashboard/keys/KeysPageClient.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let container;
let root;
const response = (body) => ({ ok: true, json: async () => body });
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  container = document.createElement("div");
  // As in the overlay unit suite, emulate only the native dialog primitive;
  // the endpoint's real button, state transition, Modal and form stay mounted.
  vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function () { this.setAttribute("open", ""); });
  vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function () { this.removeAttribute("open"); });
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function installResponses(keys, catalog) {
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    switch (String(url)) {
      case "/api/keys": return keys.promise;
      case "/api/combos": return response({ combos: [] });
      case "/api/keys/policy-catalog": return catalog.promise;
      default: throw new Error(`Unexpected endpoint request: ${url}`);
    }
  }));
}

it("withholds Create Key until the key list settles, then opens the real dialog without waiting for the optional catalog", async () => {
  const keys = deferred();
  const catalog = deferred();
  installResponses(keys, catalog);
  await act(async () => root.render(React.createElement(KeysPage)));
  expect(within(container).queryByRole("button", { name: "Create Key", exact: true })).toBeNull();

  await act(async () => keys.resolve(response({ keys: [{ id: "fixture-key", name: "Fictional key", isActive: true, createdAt: "2026-01-01T00:00:00Z", policy: {} }], providerConnections: [] })));
  const create = within(container).getByRole("button", { name: "Create Key", exact: true });
  expect(create.disabled).toBe(false);
  await act(async () => create.click());
  const dialog = within(document.body).getByRole("dialog", { name: "Create API Key", exact: true });
  expect(dialog.open).toBe(true);
  expect(within(dialog).getByRole("textbox", { name: "Key Name" })).toBeTruthy();
  await act(async () => catalog.resolve(response({ models: [] })));
});

it("settles initial readiness after a key-list failure and surfaces the error", async () => {
  const keys = deferred();
  const catalog = deferred();
  installResponses(keys, catalog);
  vi.spyOn(console, "log").mockImplementation(() => {});
  await act(async () => root.render(React.createElement(KeysPage)));
  await act(async () => {
    keys.reject(new Error("Key store unavailable"));
    catalog.resolve(response({ models: [] }));
  });
  expect(within(container).getByText("Key store unavailable").getAttribute("role")).toBe("alert");
});
