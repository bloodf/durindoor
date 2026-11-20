// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({ data: null }));
vi.mock("@/lib/db/driver.js", () => ({
  getAdapter: async () => ({
    get: () => database.data === null ? undefined : { data: database.data },
    run: (_sql, [data]) => { database.data = data; },
    transaction: (write) => write(),
  }),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }));
vi.mock("next/link", () => ({ default: ({ children, href, ...props }) => createElement("a", { href, ...props }, children) }));

import { getSettings, updateSettings } from "@/lib/db/repos/settingsRepo.js";
import useSettingsStore from "@/store/settingsStore";
import Sidebar from "@/shared/components/Sidebar.js";

const response = (data, ok = true) => ({ ok, json: async () => data });
let root;
let container;
beforeEach(() => {
  database.data = null;
  useSettingsStore.setState({ settings: null, loading: false, error: null, lastFetched: 0 });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("dashboard update notification preference", () => {
  it.each([null, JSON.stringify({ requireLogin: false })])("defaults on for new and legacy settings %j", async (data) => {
    database.data = data;
    expect((await getSettings()).showUpdateNotifications).toBe(true);
  });
  it("persists opt-out across unrelated updates and allows re-enabling", async () => {
    await updateSettings({ showUpdateNotifications: false });
    await updateSettings({ requireLogin: false });
    expect(await getSettings()).toMatchObject({ showUpdateNotifications: false, requireLogin: false });
    await updateSettings({ showUpdateNotifications: true });
    expect(await getSettings()).toMatchObject({ showUpdateNotifications: true, requireLogin: false });
  });
  it("does not let a late settings read undo a successful opt-out", async () => {
    let finishRead;
    vi.stubGlobal("fetch", vi.fn((_url, options) => options?.method === "PATCH"
      ? Promise.resolve(response({ showUpdateNotifications: false }))
      : new Promise((resolve) => { finishRead = resolve; })));
    const read = useSettingsStore.getState().fetchSettings();
    await useSettingsStore.getState().patchSettings({ showUpdateNotifications: false });
    finishRead(response({ showUpdateNotifications: true }));
    await read;
    expect(useSettingsStore.getState().settings.showUpdateNotifications).toBe(false);
  });
  it("waits for settings, suppresses disabled checks and ignores late version responses", async () => {
    vi.useFakeTimers();
    let finishVersion;
    const fetchMock = vi.fn((url) => url === "/api/settings"
      ? Promise.resolve(response({ showUpdateNotifications: false }))
      : new Promise((resolve) => { finishVersion = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => { root.render(createElement(Sidebar)); });
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/version")).toHaveLength(0);
    await act(async () => { useSettingsStore.setState({ settings: { showUpdateNotifications: true } }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/version")).toHaveLength(1);
    await act(async () => { useSettingsStore.setState({ settings: { showUpdateNotifications: false } }); });
    await act(async () => { finishVersion(response({ hasUpdate: true, latestVersion: "999" })); });
    expect(container.textContent).not.toContain("New version available");
    await act(async () => { useSettingsStore.setState({ settings: { showUpdateNotifications: true } }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/version")).toHaveLength(2);
    await act(async () => { finishVersion(response({ hasUpdate: true, latestVersion: "999" })); });
    expect(container.textContent).toContain("New version available: v999");
  });
});
