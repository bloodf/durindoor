// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { within } from "@testing-library/dom";

const navMocks = vi.hoisted(() => ({
  pathname: "/dashboard",
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navMocks.pathname,
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }) => React.createElement("a", { href, ...props }, children),
}));

import api from "../../src/shared/utils/api.js";
import useSettingsStore from "../../src/store/settingsStore.js";
import Sidebar from "../../src/shared/components/Sidebar.js";
import PostgresConnectionTarget from "../../src/app/(dashboard)/dashboard/settings/database/components/PostgresConnectionTarget.jsx";
import StartupConfiguration from "../../src/app/(dashboard)/dashboard/settings/database/components/StartupConfiguration.jsx";
import DatabaseSettingsPage from "../../src/app/(dashboard)/dashboard/settings/database/page.js";
import ProfilePage from "../../src/app/(dashboard)/dashboard/profile/page.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const flush = () => new Promise((resolve) => setTimeout(resolve, 25));

let host;
let root;

beforeEach(() => {
  useSettingsStore.getState().invalidate();
  useSettingsStore.setState({ settings: null, loading: false, error: null, errorStatus: null, errorBody: null, lastFetched: 0 });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("shared HTTP client (#2305)", () => {
  it("returns parsed JSON across request helpers and preserves single content-type header", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ items: [1] }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ created: true }) })
      .mockResolvedValueOnce({ ok: true, status: 204, json: async () => { throw new SyntaxError("no body"); } });
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.get("/api/items")).resolves.toEqual({ items: [1] });
    await expect(api.post("/api/items", { name: "x" }, { headers: { "content-type": "application/json", "x-9r-password": "pw" } }))
      .resolves.toEqual({ created: true });
    await expect(api.del("/api/items/1")).resolves.toBeNull();

    expect(fetchMock.mock.calls[1][1].headers).toEqual({
      "content-type": "application/json",
      "x-9r-password": "pw",
    });
  });

  it("throws one error shape on non-2xx JSON and non-JSON bodies", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 400, statusText: "Bad Request", json: async () => ({ error: "Invalid payload" }) })
      .mockResolvedValueOnce({ ok: false, status: 502, statusText: "Bad Gateway", json: async () => { throw new SyntaxError("Unexpected <"); } })
      .mockResolvedValueOnce({ ok: false, status: 503, statusText: "", json: async () => { throw new SyntaxError("Unexpected <"); } })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => { throw new SyntaxError("Unexpected <"); } });
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.get("/api/json-fail")).rejects.toMatchObject({
      name: "Error",
      message: "Invalid payload",
      status: 400,
      body: { error: "Invalid payload" },
    });
    await expect(api.post("/api/html-fail", {})).rejects.toMatchObject({
      name: "Error",
      message: "Bad Gateway",
      status: 502,
      body: null,
    });
    await expect(api.patch("/api/empty-status", {})).rejects.toMatchObject({
      name: "Error",
      message: "Request failed (503)",
      status: 503,
      body: null,
    });
    await expect(api.get("/api/non-json-ok")).resolves.toBeNull();
  });

  it("honors AbortSignal before fetch, in flight, and during body parsing", async () => {
    const preAborted = new AbortController();
    const preReason = new DOMException("Already cancelled", "AbortError");
    preAborted.abort(preReason);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.get("/api/never", { signal: preAborted.signal })).rejects.toBe(preReason);
    expect(fetchMock).not.toHaveBeenCalled();

    const bodyController = new AbortController();
    const bodyReason = new DOMException("Aborted during parse", "AbortError");
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        bodyController.abort(bodyReason);
        return { ok: true };
      },
    })));
    await expect(api.get("/api/parse-abort", { signal: bodyController.signal })).rejects.toBe(bodyReason);
  });

  it("removes raw fetch calls from migrated settings, sidebar, and profile modules", () => {
    const files = [
      "../../src/store/settingsStore.js",
      "../../src/shared/components/Sidebar.js",
      "../../src/app/(dashboard)/dashboard/profile/page.js",
      "../../src/app/(dashboard)/dashboard/settings/database/page.js",
      "../../src/app/(dashboard)/dashboard/settings/database/components/PostgresConnectionTarget.jsx",
      "../../src/app/(dashboard)/dashboard/settings/database/components/StartupConfiguration.jsx",
    ];
    for (const file of files) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(source, file).not.toMatch(/\bfetch\s*\(/);
    }
  });
});

describe("migrated callers (#2305)", () => {
  it("Sidebar loads /api/version through api and tolerates non-JSON failures", async () => {
    vi.useFakeTimers();
    useSettingsStore.setState({ settings: { showUpdateNotifications: true }, lastFetched: Date.now() });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 502, statusText: "Bad Gateway", json: async () => { throw new SyntaxError("html"); } })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ hasUpdate: true, latestVersion: "9.9.9" }) });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => { root.render(React.createElement(Sidebar)); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
    expect(host.textContent).not.toContain("New version available");

    await act(async () => { useSettingsStore.setState({ settings: { showUpdateNotifications: false } }); });
    await act(async () => { useSettingsStore.setState({ settings: { showUpdateNotifications: true } }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
    expect(host.textContent).toContain("New version available: v9.9.9");
  });

  it("PostgresConnectionTarget handles success, non-JSON error, and 401 unauthorized", async () => {
    const onUnauthorized = vi.fn();
    const onPersisted = vi.fn(async () => {});
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true, latencyMs: 5, serverVersion: "PG 17" }) })
      .mockResolvedValueOnce({ ok: false, status: 500, statusText: "Server Error", json: async () => { throw new SyntaxError("html"); } })
      .mockResolvedValueOnce({ ok: false, status: 401, statusText: "Unauthorized", json: async () => ({ error: "Unauthorized" }) });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(React.createElement(PostgresConnectionTarget, {
        effective: { host: "db.local", port: "5432", database: "app", user: "op", sslmode: "require" },
        password: "secret",
        onUnauthorized,
        onPersisted,
      }));
    });

    const btn = () => within(host).getByRole("button", { name: "Test connection and save target" });
    await act(async () => btn().click());
    expect(onPersisted).toHaveBeenCalledTimes(1);
    expect(within(host).getByRole("status").textContent).toContain("Connected in 5ms");

    await act(async () => btn().click());
    expect(within(host).getByRole("alert").textContent).toContain("Server Error");

    await act(async () => btn().click());
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("StartupConfiguration handles DELETE remove, failure, and 401 unauthorized", async () => {
    const onUnauthorized = vi.fn();
    const onSaved = vi.fn();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true, restartRequired: true, startupEnv: { exists: false, effective: { engine: "sqlite" } } }) })
      .mockResolvedValueOnce({ ok: false, status: 401, statusText: "Unauthorized", json: async () => ({ error: "Unauthorized" }) });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(React.createElement(StartupConfiguration, {
        startupEnv: { exists: true, keys: {}, effective: { engine: "sqlite", host: "", port: "5432", database: "", user: "", sslmode: "require" } },
        password: "secret",
        onUnauthorized,
        onSaved,
      }));
    });

    const removeBtn = within(host).getByRole("button", { name: "Remove override" });
    await act(async () => removeBtn.click());
    expect(fetchMock.mock.calls[0][1].method).toBe("DELETE");
    expect(within(host).getByText("Managed override removed")).toBeTruthy();

    await act(async () => removeBtn.click());
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("DatabaseSettingsPage handles 401 reset and rollback failure via shared client", async () => {
    const engine = { activeEngine: "postgres", databasePgVersion: 17, snapshots: ["snap-1"], startupEnv: { exists: false, keys: {}, effective: {} } };
    const fetchMock = vi.fn(async (url) => {
      if (url === "/api/settings/database/engine") return { ok: true, status: 200, json: async () => engine };
      if (url === "/api/settings/database/rollback") return { ok: false, status: 500, statusText: "Rollback Error", json: async () => { throw new SyntaxError("html"); } };
      return { ok: true, status: 200, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => { root.render(React.createElement(DatabaseSettingsPage, { initialPassword: "secret" })); await flush(); });
    await act(async () => within(host).getByRole("button", { name: "Switch back to SQLite" }).click());
    const dialog = within(document.body).getByRole("dialog", { name: "Switch back to SQLite" });
    await act(async () => { within(dialog).getByRole("button", { name: "Rollback" }).click(); await flush(); });
    expect(within(host).getByRole("alert").textContent).toContain("Rollback failed (500)");

    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, statusText: "Unauthorized", json: async () => ({ error: "Denied" }) });
    await act(async () => { within(host).getByRole("button", { name: "Retry status" }).click(); await flush(); });
    expect(document.body.textContent).toContain("Password rejected — try again.");
  });

  it("ProfilePage runs retention and proxy test with consistent success and error feedback", async () => {
    const fetchMock = vi.fn(async (url, options) => {
      if (url === "/api/settings") return { ok: true, status: 200, json: async () => ({ fallbackStrategy: "fill-first", outboundProxyEnabled: true, outboundProxyUrl: "http://127.0.0.1:7897", authMode: "password" }) };
      if (url === "/api/auth/status") return { ok: true, status: 200, json: async () => ({ passwordAvailable: true, oidcAvailable: false }) };
      if (url === "/api/data-retention" && (!options?.method || options.method === "GET")) return { ok: true, status: 200, json: async () => ({ lastRun: null }) };
      if (url === "/api/data-retention" && options?.method === "POST") return { ok: false, status: 500, statusText: "Server Error", json: async () => ({ error: "Cleanup blocked" }) };
      if (url === "/api/settings/proxy-test") return { ok: true, status: 200, json: async () => ({ ok: true, status: 204, elapsedMs: 12 }) };
      return { ok: true, status: 200, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => { root.render(React.createElement(ProfilePage)); await flush(); });
    await act(async () => { await flush(); });

    await act(async () => { within(host).getByRole("tab", { name: /Network/i }).click(); await flush(); });
    await act(async () => { within(host).getByRole("button", { name: "Test proxy URL" }).click(); await flush(); });
    expect(host.textContent).toContain("Proxy test OK (204) in 12ms");

    await act(async () => { within(host).getByRole("tab", { name: /System/i }).click(); await flush(); });
    await act(async () => { within(host).getByRole("button", { name: "Clean now" }).click(); await flush(); });
    expect(host.textContent).toContain("Cleanup blocked");
  });
});
