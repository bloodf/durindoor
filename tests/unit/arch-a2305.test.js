import { afterEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import useSettingsStore from "../../src/store/settingsStore.js";

afterEach(() => vi.unstubAllGlobals());

it("publishes a successful settings response to subscribers and retains it on failure", async () => {
  useSettingsStore.setState({ settings: { sidebar: true, other: "kept" } });
  const fetch = vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ sidebar: false, other: "kept" }) })
    .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: "failed" }) });
  vi.stubGlobal("fetch", fetch);
  const seen = [];
  const unsubscribe = useSettingsStore.subscribe((state) => seen.push(state.settings));
  await useSettingsStore.getState().patchSettings({ sidebar: false });
  expect(useSettingsStore.getState().settings).toEqual({ sidebar: false, other: "kept" });
  expect(seen).toContainEqual({ sidebar: false, other: "kept" });
  await useSettingsStore.getState().patchSettings({ sidebar: true });
  expect(useSettingsStore.getState().settings).toEqual({ sidebar: false, other: "kept" });
  expect(fetch).toHaveBeenCalledTimes(2);
  unsubscribe();
});

it("routes dashboard settings writes through the store", () => {
  const root = new URL("../../src/app/(dashboard)/dashboard/", import.meta.url);
  for (const [path, pattern] of [
    ["combos/page.js", /patchSettings\(/],
    ["profile/page.js", /requestSettings\(/],
    ["cli-tools/components/ClaudeToolCard.js", /patchSettings\(/],
  ]) {
    const source = readFileSync(new URL(path, root), "utf8");
    expect(source).toMatch(pattern);
    expect(source).not.toMatch(/fetch\(["']\/api\/settings["']/);
  }
});
