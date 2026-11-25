import { afterEach, beforeEach, expect, it, vi } from "vitest";
import useSettingsStore from "../../src/store/settingsStore.js";

beforeEach(() => {
  useSettingsStore.getState().invalidate();
  useSettingsStore.setState({ settings: { version: "initial" }, error: null, lastFetched: 0 });
});

afterEach(() => vi.unstubAllGlobals());

it("keeps the first successful save when a newer save fails", async () => {
  let resolveFirst;
  let rejectSecond;
  vi.stubGlobal("fetch", vi.fn()
    .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
    .mockImplementationOnce(() => new Promise((_, reject) => { rejectSecond = reject; })));

  const first = useSettingsStore.getState().patchSettings({ version: "first" });
  const second = useSettingsStore.getState().patchSettings({ version: "second" });

  resolveFirst({ ok: true, status: 200, json: async () => ({ version: "first" }) });
  await expect(first).resolves.toEqual({ version: "first" });
  rejectSecond(Object.assign(new Error("save failed"), { status: 500, body: { error: "save failed" } }));
  await expect(second).resolves.toBeNull();

  expect(useSettingsStore.getState()).toMatchObject({
    settings: { version: "first" },
    error: "save failed",
    errorStatus: 500,
    errorBody: { error: "save failed" },
  });
});
