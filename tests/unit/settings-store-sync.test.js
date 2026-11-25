import { afterEach, beforeEach, expect, it, vi } from "vitest";
import useSettingsStore, { requestSettings } from "../../src/store/settingsStore.js";

beforeEach(() => {
  useSettingsStore.getState().invalidate();
  useSettingsStore.setState({ settings: null, error: null });
});

afterEach(() => vi.unstubAllGlobals());

const settingsResponse = (body) => ({ ok: true, json: async () => body });

it("deduplicates reads and immediately publishes a PATCH to Sidebar subscribers", async () => {
  let resolveRead;
  const fetch = vi.fn().mockImplementationOnce(() => new Promise((resolve) => { resolveRead = resolve; }))
    .mockResolvedValueOnce({ ok: true, json: async () => ({ showUpdateNotifications: false }) });
  vi.stubGlobal("fetch", fetch);
  const first = useSettingsStore.getState().fetchSettings();
  const second = useSettingsStore.getState().fetchSettings();
  expect(fetch).toHaveBeenCalledTimes(1);
  resolveRead({ ok: true, json: async () => ({ showUpdateNotifications: true }) });
  await Promise.all([first, second]);
  const observed = [];
  const unsubscribe = useSettingsStore.subscribe((state) => observed.push(state.settings?.showUpdateNotifications));
  await useSettingsStore.getState().patchSettings({ showUpdateNotifications: false });
  unsubscribe();
  expect(useSettingsStore.getState().settings.showUpdateNotifications).toBe(false);
  expect(observed).toContain(false);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[1]).toEqual(["/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: '{"showUpdateNotifications":false}' }]);
});


it("keeps the provider settings timeout independent of a pending sidebar read", async () => {
  let resolveSidebar;
  const fetch = vi.fn()
    .mockImplementationOnce(() => new Promise((resolve) => { resolveSidebar = resolve; }))
    .mockImplementationOnce((_, { signal }) => new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }));
  vi.stubGlobal("fetch", fetch);

  const sidebar = useSettingsStore.getState().fetchSettings();
  const controller = new AbortController();
  const provider = requestSettings({ cache: "no-store", signal: controller.signal });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[1][1]).toMatchObject({ cache: "no-store", signal: controller.signal });

  const timeout = new DOMException("Settings request timed out", "TimeoutError");
  controller.abort(timeout);
  await expect(provider).rejects.toBe(timeout);
  expect(useSettingsStore.getState()).toMatchObject({ loading: true, error: null });

  const survivingReader = useSettingsStore.getState().fetchSettings();
  expect(fetch).toHaveBeenCalledTimes(2);
  resolveSidebar(settingsResponse({ showUpdateNotifications: true }));
  await expect(sidebar).resolves.toEqual({ showUpdateNotifications: true });
  await expect(survivingReader).resolves.toEqual({ showUpdateNotifications: true });
  expect(useSettingsStore.getState().loading).toBe(false);
});

it("does not share a cancelable request with a later ordinary reader", async () => {
  let resolveOrdinary;
  const fetch = vi.fn()
    .mockImplementationOnce((_, { signal }) => new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }))
    .mockImplementationOnce(() => new Promise((resolve) => { resolveOrdinary = resolve; }));
  vi.stubGlobal("fetch", fetch);

  const controller = new AbortController();
  const modalRead = requestSettings({ signal: controller.signal });
  const ordinaryRead = useSettingsStore.getState().fetchSettings();
  expect(fetch).toHaveBeenCalledTimes(2);
  controller.abort();
  await expect(modalRead).rejects.toMatchObject({ name: "AbortError" });

  resolveOrdinary(settingsResponse({ version: "available" }));
  await expect(ordinaryRead).resolves.toEqual({ version: "available" });
  expect(useSettingsStore.getState()).toMatchObject({ error: null, loading: false });
});

it("gives a forced refresh a fresh read and keeps its snapshot when an older read finishes", async () => {
  let resolveOldRead;
  const fetch = vi.fn()
    .mockImplementationOnce(() => new Promise((resolve) => { resolveOldRead = resolve; }))
    .mockResolvedValueOnce(settingsResponse({ version: "fresh" }));
  vi.stubGlobal("fetch", fetch);

  const oldRead = useSettingsStore.getState().fetchSettings();
  await expect(useSettingsStore.getState().fetchSettings({ force: true })).resolves.toEqual({ version: "fresh" });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[1][1]).toMatchObject({ cache: "no-store" });

  resolveOldRead(settingsResponse({ version: "old" }));
  await expect(oldRead).resolves.toEqual({ version: "fresh" });
  await expect(useSettingsStore.getState().fetchSettings()).resolves.toEqual({ version: "fresh" });
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("keeps an accepted PATCH when a read from its previous revision completes", async () => {
  let resolveRead;
  vi.stubGlobal("fetch", vi.fn()
    .mockImplementationOnce(() => new Promise((resolve) => { resolveRead = resolve; }))
    .mockResolvedValueOnce(settingsResponse({ version: "saved" })));

  const oldRead = useSettingsStore.getState().fetchSettings({ force: true });
  await useSettingsStore.getState().patchSettings({ version: "saved" });
  resolveRead(settingsResponse({ version: "old" }));

  await expect(oldRead).resolves.toEqual({ version: "saved" });
  expect(useSettingsStore.getState()).toMatchObject({ settings: { version: "saved" }, loading: false });
});

it.each([
  ["non-JSON", async () => { throw new SyntaxError("Unexpected token"); }],
  ["null", async () => null],
  ["an array", async () => []],
])("treats a successful settings response containing %s as a failed read", async (_, json) => {
  const previousSettings = { showUpdateNotifications: true };
  useSettingsStore.setState({ settings: previousSettings });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json }));

  const response = await requestSettings();
  expect(response.ok).toBe(false);
  await expect(response.json()).resolves.toEqual({ error: "Settings could not be loaded." });
  expect(useSettingsStore.getState()).toMatchObject({
    settings: previousSettings,
    error: "Settings could not be loaded.",
    lastFetched: 0,
    loading: false,
  });
});
