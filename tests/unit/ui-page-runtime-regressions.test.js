// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { within } from "@testing-library/dom";

const route = vi.hoisted(() => ({ params: new URLSearchParams() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => route.params }));
import CallbackPage from "../../src/app/callback/page.js";
import ProxyPoolsPage from "../../src/app/(dashboard)/dashboard/proxy-pools/page.js";
import EndpointPage from "../../src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let container;
let root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each([
  ["", "Copy this URL"],
  ["code=fixture&state=fixture", "Authorization successful!"],
  ["error=denied&error_description=Provider+refused", "Authorization failed"],
])("renders callback state with receiver-sensitive browser timers: %s", async (query, heading) => {
  route.params = new URLSearchParams(query);
  const timers = new Map();
  let nextId = 0;
  vi.spyOn(window, "setTimeout").mockImplementation(function (fn, delay) {
    if (this !== window) throw new TypeError("Illegal invocation");
    const id = ++nextId;
    timers.set(id, { fn, delay });
    return id;
  });
  vi.spyOn(window, "clearTimeout").mockImplementation(function (id) {
    if (this !== window) throw new TypeError("Illegal invocation");
    timers.delete(id);
  });
  await act(async () => root.render(React.createElement(CallbackPage)));
  await act(async () => {
    for (const [id, timer] of timers) if (timer.delay === 0) { timers.delete(id); timer.fn(); }
  });
  expect(within(container).getByRole("heading", { name: heading })).toBeTruthy();
  await act(async () => root.unmount());
  expect(timers.size).toBe(0);
  root = createRoot(container);
});

it("renders proxy pool recovery actions when no pools exist", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ proxyPools: [] }) })));
  await act(async () => { root.render(React.createElement(ProxyPoolsPage)); });
  expect(within(container).getByRole("heading", { name: "Proxy Pools" })).toBeTruthy();
  const header = within(container).getByRole("heading", { name: "Proxy Pools" }).closest("header");
  expect(within(header).getByRole("button", { name: "Add proxy pool", exact: true }).disabled).toBe(false);
});

it("shows a rejected key-list request rather than claiming the collection is empty", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    const failed = String(url) === "/api/keys";
    return { ok: !failed, status: failed ? 503 : 200, json: async () => failed ? { error: "Key store unavailable" } : {} };
  }));
  await act(async () => { root.render(React.createElement(EndpointPage, { machineId: "qa-machine" })); });
  expect(within(container).getByText("Key store unavailable").getAttribute("role")).toBe("alert");
});
