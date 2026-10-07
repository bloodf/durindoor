// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { within } from "@testing-library/dom";
import DatabaseSettingsPage from "../../src/app/(dashboard)/dashboard/settings/database/page.js";

let host;
let root;
let requests;
let probeOk;
const status = { activeEngine: "sqlite", databaseEngine: "sqlite", snapshots: [], startupEnv: { exists: false, keys: {}, effective: { engine: "sqlite", host: "db.example.com", port: "5432", database: "target", user: "operator", sslmode: "require" } } };
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  requests = [];
  probeOk = true;
  vi.stubGlobal("fetch", vi.fn(async (url, options) => {
    requests.push({ url, options });
    if (url === "/api/settings/database/engine") return { ok: true, status: 200, json: async () => status };
    if (url === "/api/settings/database/test") return { ok: probeOk, status: probeOk ? 200 : 400, json: async () => probeOk ? { ok: true, latencyMs: 2, serverVersion: "PostgreSQL 17" } : { ok: false, error: "PostgreSQL connection probe failed" } };
    throw new Error("Unexpected request");
  }));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const button = (text) => within(host).getByRole("button", { name: text, exact: true });
const input = (label) => {
  const labels = [...host.querySelectorAll("label")].filter((node) => node.textContent.trim() === label);
  expect(labels).toHaveLength(1);
  const element = document.getElementById(labels[0].htmlFor);
  expect(element).not.toBeNull();
  expect(host.contains(element)).toBe(true);
  expect(element.tagName).toBe("INPUT");
  return element;
};
async function type(label, value) {
  await act(async () => {
    const element = input(label);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("restores a configurable cutover target below startup settings without exposing stored credentials or changing the engine radio", async () => {
  await act(async () => root.render(React.createElement(DatabaseSettingsPage, { initialPassword: "dashboard" })));
  expect(host.textContent).toContain("Startup configuration");
  expect(host.textContent).toContain("PostgreSQL connection");
  expect(host.textContent.indexOf("Startup configuration")).toBeLessThan(host.textContent.indexOf("PostgreSQL connection"));
  expect(input("Target host").value).toBe("db.example.com");
  expect(input("Target password").type).toBe("password");
  expect(input("Target password").value).toBe("");
  await type("Target password", "private-target-password");
  await act(async () => button("Test connection and save target").click());
  const sent = JSON.parse(requests.find((item) => item.url === "/api/settings/database/test").options.body);
  expect(sent).toMatchObject({ host: "db.example.com", password: "private-target-password", persist: true });
  expect(input("Target password").value).toBe("");
  expect(host.textContent).toContain("Ready for cutover without restarting");
  expect(host.querySelector('input[name="startup-engine"][value="sqlite"]').checked).toBe(true);
  expect(button("Cut over to Postgres").disabled).toBe(false);
  expect(requests.some((item) => item.url.startsWith("/api/settings/database/startup-env"))).toBe(false);
  expect(host.textContent).not.toContain("private-target-password");
  expect(host.textContent).not.toContain("postgresql://");
});

it("keeps the target editable after a failed probe and does not report success or restart changes", async () => {
  probeOk = false;
  await act(async () => root.render(React.createElement(DatabaseSettingsPage, { initialPassword: "dashboard" })));
  await type("Target password", "private-target-password");
  await act(async () => button("Test connection and save target").click());
  expect(host.querySelector('[role="alert"]').textContent).toContain("probe failed");
  expect(button("Test connection and save target").disabled).toBe(false);
  expect(host.textContent).not.toContain("Target saved");
  expect(host.textContent).not.toContain("Restart DurinDoor");
});
