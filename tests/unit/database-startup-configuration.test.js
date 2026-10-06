// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import StartupConfiguration from "../../src/app/(dashboard)/dashboard/settings/database/components/StartupConfiguration.jsx";

let host;
let root;
const startupEnv = { exists: false, effective: { engine: "postgres", host: "db.example.com", port: "5432", database: "durindoor", user: "operator", sslmode: "require" }, keys: { DURINDOOR_PG_URL: { source: "process" } } };
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
const button = (label) => [...host.querySelectorAll("button")].find((item) => item.textContent === label);

it("keeps passwords write-only and leaves the restart banner visible after refresh", async () => {
  const saved = vi.fn();
  const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true, restartRequired: true, startupEnv: { ...startupEnv, exists: true } }) });
  vi.stubGlobal("fetch", fetch);
  await act(async () => root.render(React.createElement(StartupConfiguration, { startupEnv, password: "dashboard", onSaved: saved, onUnauthorized: vi.fn() })));
  expect(host.querySelector('input[type="password"]').value).toBe("");
  expect(host.textContent).toContain("from environment");
  await act(async () => button("Save").click());
  const payload = JSON.parse(fetch.mock.calls[0][1].body);
  expect(Object.hasOwn(payload, "password")).toBe(false);
  expect(payload.host).toBe("db.example.com");
  expect(host.textContent).toContain("Restart DurinDoor to apply startup changes");
  await act(async () => root.render(React.createElement(StartupConfiguration, { startupEnv: { ...startupEnv, exists: true }, password: "dashboard", onSaved: saved, onUnauthorized: vi.fn() })));
  expect(host.textContent).toContain("Restart DurinDoor to apply startup changes");
  expect(host.textContent).not.toContain("postgresql://");
});

it("shows a failed probe and does not announce saved changes", async () => {
  const saved = vi.fn();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: "PostgreSQL connection probe failed" }) }));
  await act(async () => root.render(React.createElement(StartupConfiguration, { startupEnv, password: "dashboard", onSaved: saved, onUnauthorized: vi.fn() })));
  await act(async () => button("Test").click());
  expect(host.querySelector('[role="alert"]').textContent).toContain("probe failed");
  expect(saved).not.toHaveBeenCalled();
  expect(host.textContent).not.toContain("Restart DurinDoor");
});
