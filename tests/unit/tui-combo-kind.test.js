import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const api = require("../../cli/src/cli/api/client.js");
const input = require("../../cli/src/cli/utils/input.js");
const menu = require("../../cli/src/cli/utils/menuHelper.js");
const display = require("../../cli/src/cli/utils/display.js");

afterEach(() => vi.restoreAllMocks());

describe("CLI combo creation", () => {
  it("shows chat and unknown kinds using the exact saved IDs", async () => {
    const rows = [
      { provider: "openai", model: "gpt-4o", fullModel: "openai/gpt-4o", kind: "llm" },
      { provider: "openai", model: "gpt-image-1", fullModel: "openai/gpt-image-1", kind: "image" },
      { provider: "search", model: "fetch", fullModel: "search/fetch", kind: "webFetch" },
      { provider: "old", model: "model", fullModel: "old/custom", kind: undefined },
      { provider: "future", model: "model", fullModel: "future/custom", kind: "future-kind" },
    ];
    vi.spyOn(api, "getModels").mockResolvedValue({ success: true, data: { models: rows } });
    const create = vi.spyOn(api, "createCombo").mockResolvedValue({ success: true });
    const replies = ["test-combo", "1", "2", "3", "done"];
    vi.spyOn(input, "prompt").mockImplementation(async () => replies.shift());
    vi.spyOn(input, "pause").mockResolvedValue();
    vi.spyOn(display, "clearScreen").mockImplementation(() => {});
    vi.spyOn(display, "showStatus").mockImplementation(() => {});
    vi.spyOn(menu, "showListMenu").mockImplementation(async (config) => config.createAction.action());
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    delete require.cache[require.resolve("../../cli/src/cli/menus/combos.js")];
    const { showCombosMenu } = require("../../cli/src/cli/menus/combos.js");
    await showCombosMenu();
    const printed = log.mock.calls.map((args) => args.join(" ")).join("\n");
    expect(printed).toContain("openai/gpt-4o");
    expect(printed).toContain("old/custom");
    expect(printed).toContain("future/custom");
    expect(printed).not.toContain("gpt-image-1");
    expect(printed).not.toContain("search/fetch");
    expect(create).toHaveBeenCalledWith({ name: "test-combo", models: ["openai/gpt-4o", "old/custom", "future/custom"] });
  });
});
