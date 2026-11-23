import { describe, expect, it } from "vitest";
import { summarizeToolSources } from "../../src/sse/utils/toolSources.js";

describe("tool source diagnostics", () => {
  const tools = [{ name: "mcp__files__read" }, { function: { name: "web_search" } }, { name: "custom\nname" }];
  it("requires explicit opt-in and summarizes names without log injection", () => {
    expect(summarizeToolSources(tools, false)).toBeNull();
    expect(summarizeToolSources(tools, true)).toBe("3 tools | sources: mcp:files=1, hosted:web=1, client=1 | names: mcp__files__read, web_search, custom_name");
    expect(summarizeToolSources([], true)).toBeNull();
  });
});

it("protects the diagnostic setting from unauthenticated changes", async () => {
  const { AUTH_CRITICAL_SETTING_KEYS, stripSettingKeys } = await import("../../src/lib/settings/settingsPatchAuth.js");
  const updates = { logToolSources: true };
  expect(stripSettingKeys(updates, AUTH_CRITICAL_SETTING_KEYS)).toBe(true);
  expect(updates).toEqual({});
});
