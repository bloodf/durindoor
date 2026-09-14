// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { within } from "@testing-library/dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import EndpointPage from "../../src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.jsx";

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

function installResponses(settings, status, catalog) {
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    switch (String(url)) {
      case "/api/keys": return response({ keys: [{ id: "fixture-key", name: "Fictional key", isActive: true, createdAt: "2026-01-01T00:00:00Z", policy: {} }], providerConnections: [] });
      case "/api/combos": return response({ combos: [] });
      case "/api/settings": return settings.promise;
      case "/api/tunnel/status": return status.promise;
      case "/api/keys/policy-catalog": return catalog.promise;
      default: throw new Error(`Unexpected endpoint request: ${url}`);
    }
  }));
}

it("withholds Create Key until settings and status settle, then opens the real dialog without waiting for the optional catalog", async () => {
  const settings = deferred();
  const status = deferred();
  const catalog = deferred();
  installResponses(settings, status, catalog);
  await act(async () => root.render(React.createElement(EndpointPage, { machineId: "fictional-machine" })));
  expect(within(container).queryByRole("button", { name: "Create Key", exact: true })).toBeNull();

  await act(async () => settings.resolve(response({ requireLogin: true, hasPassword: false })));
  expect(within(container).queryByRole("button", { name: "Create Key", exact: true })).toBeNull();

  await act(async () => status.resolve(response({ tunnel: { enabled: false }, tailscale: { enabled: false } })));
  const create = within(container).getByRole("button", { name: "Create Key", exact: true });
  expect(create.disabled).toBe(false);
  expect(within(container).getByText("Change the default dashboard password before activating the tunnel.")).toBeTruthy();
  await act(async () => create.click());
  const dialog = within(document.body).getByRole("dialog", { name: "Create API Key", exact: true });
  expect(dialog.open).toBe(true);
  expect(within(dialog).getByRole("textbox", { name: "Key Name" })).toBeTruthy();
  await act(async () => catalog.resolve(response({ models: [] })));
});

it("settles initial readiness after a settings failure instead of permanently blocking key actions", async () => {
  const settings = deferred();
  const status = deferred();
  const catalog = deferred();
  installResponses(settings, status, catalog);
  vi.spyOn(console, "log").mockImplementation(() => {});
  await act(async () => root.render(React.createElement(EndpointPage, { machineId: "fictional-machine" })));
  expect(within(container).queryByRole("button", { name: "Create Key", exact: true })).toBeNull();
  await act(async () => {
    status.resolve(response({ tunnel: { enabled: false }, tailscale: { enabled: false } }));
    settings.reject(new Error("Settings unavailable"));
    catalog.resolve(response({ models: [] }));
  });
  const create = within(container).getByRole("button", { name: "Create Key", exact: true });
  await act(async () => create.click());
  expect(within(document.body).getByRole("dialog", { name: "Create API Key", exact: true }).open).toBe(true);
});
