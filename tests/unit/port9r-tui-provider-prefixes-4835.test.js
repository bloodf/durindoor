import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const api = require("../../cli/src/cli/api/client.js");
const input = require("../../cli/src/cli/utils/input.js");
const display = require("../../cli/src/cli/utils/display.js");
const selectorPath = require.resolve("../../cli/src/cli/utils/modelSelector.js");

beforeEach(() => {
  vi.spyOn(api, "getAvailableModels").mockResolvedValue({ success: true, data: { data: [] } });
  vi.spyOn(input, "prompt").mockResolvedValue("1");
  vi.spyOn(display, "clearScreen").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  delete require.cache[selectorPath];
});

afterEach(() => {
  delete require.cache[selectorPath];
  vi.restoreAllMocks();
});

function customPrefix(prefix) {
  api.getAvailableModels.mockResolvedValue({
    success: true,
    data: { data: [{ id: `${prefix}/first`, owned_by: prefix }, { id: `${prefix}/second`, owned_by: prefix }] },
  });
}

describe("port(upstream) #4835: TUI custom provider prefixes", () => {
  it.each(["constructor", "toString", "__proto__", "custom"])("groups models under %s", async (prefix) => {
    customPrefix(prefix);
    const { groups, combos } = await require(selectorPath).getAvailableModelsGrouped();
    expect(Object.keys(groups)).toEqual([prefix]);
    expect(groups[prefix]).toEqual([`${prefix}/first`, `${prefix}/second`]);
    expect(combos).toEqual([]);
  });

  it.each(["constructor", "toString", "__proto__"])("titles and selects a model under %s", async (prefix) => {
    customPrefix(prefix);
    expect(await require(selectorPath).selectModelFromList("Choose model")).toBe(`${prefix}/first`);
    expect(console.log).toHaveBeenCalledWith(`[${prefix}]`);
  });
});
