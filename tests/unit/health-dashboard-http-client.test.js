// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import HealthPage from "../../src/app/(dashboard)/dashboard/health/page.js";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));

const providers = "/api/health/providers";
const headroom = "/api/headroom/status";
let host;
let root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const render = () => act(async () => root.render(React.createElement(HealthPage)));
const refresh = () => act(async () => {
  [...host.querySelectorAll("button")].find((button) => button.textContent.includes("Refresh")).click();
});

it.each([
  ["null", "Configuration not yet known", "Unknown"],
  ["{", "Not configured", "Unavailable (fail-open)"],
  ["<html>Unavailable</html>", "Not configured", "Unavailable (fail-open)"],
])("renders the expected empty snapshots for body %s", async (body, configuration, status) => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(body)));
  await render();
  expect(host.textContent).toContain("No active connections");
  expect(host.textContent).toContain(configuration);
  expect(host.textContent).toContain(status);
  expect(host.querySelector('[role="alert"]')).toBeNull();
});

it("preserves server and network error messages", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    if (url === providers) return Response.json({ error: "Provider read denied" }, { status: 403 });
    throw new TypeError("Network disconnected");
  }));
  await render();
  expect(host.textContent).toContain("Provider read denied Provider measurements are unknown.");
  expect(host.textContent).toContain("Headroom status: Network disconnected. Status is unknown.");
});

it("preserves the HTTP fallback and the error from a JSON null HTTP failure", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url) => url === providers
    ? new Response("<html>Unavailable</html>", { status: 503, statusText: "Service Unavailable" })
    : Response.json(null, { status: 502 })));
  await render();
  expect(host.textContent).toContain("Health request failed (503) Provider measurements are unknown.");
  expect(host.textContent).toContain("Headroom status: Cannot read properties of null (reading 'error'). Status is unknown.");
});

it("keeps refresh requests and ignores responses that arrive after supersession", async () => {
  const initial = Promise.withResolvers();
  const fetch = vi.fn(async (url, options) => {
    if (options.method === "DELETE") return new Response(null, { status: 204 });
    if (url === providers) return initial.promise;
    return Response.json(url === headroom ? { running: true } : {
      providers: [{ id: "fresh", name: "Fresh connection", provider: "openai", state: "healthy" }],
    });
  });
  vi.stubGlobal("fetch", fetch);
  await render();
  const signal = fetch.mock.calls[0][1].signal;
  expect(signal.aborted).toBe(false);
  expect(fetch.mock.calls[0]).toEqual([providers, expect.objectContaining({ cache: "no-store", signal })]);
  expect(fetch.mock.calls[1]).toEqual([headroom, expect.objectContaining({ cache: "no-store", signal })]);

  await refresh();
  expect(signal.aborted).toBe(true);
  const refreshSignal = fetch.mock.calls[3][1].signal;
  expect(refreshSignal).toBeInstanceOf(AbortSignal);
  expect(refreshSignal.aborted).toBe(false);
  expect(fetch.mock.calls.slice(2)).toEqual([
    [providers, { method: "DELETE" }],
    [providers + "?force=1", expect.objectContaining({ cache: "no-store", signal: refreshSignal })],
    [headroom, expect.objectContaining({ cache: "no-store", signal: refreshSignal })],
  ]);

  await act(async () => initial.resolve(Response.json({ error: "Superseded error" }, { status: 500 })));
  expect(host.textContent).toContain("Fresh connection");
  expect(host.textContent).not.toContain("Superseded error");
});
