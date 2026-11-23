import { afterEach, expect, it, vi } from "vitest";
import useSettingsStore from "../../src/store/settingsStore.js";

afterEach(() => vi.unstubAllGlobals());

it("deduplicates reads and immediately publishes a PATCH to Sidebar subscribers", async () => {
  let resolveRead;
  const fetch = vi.fn().mockImplementationOnce(() => new Promise((resolve) => { resolveRead = resolve; }))
    .mockResolvedValueOnce({ ok: true, json: async () => ({ showUpdateNotifications: false }) });
  vi.stubGlobal("fetch", fetch);
  useSettingsStore.setState({ settings: null, lastFetched: 0 });
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
