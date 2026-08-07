import { describe, expect, it } from "vitest";
import { migrateCodexFeatureFlags } from "../../src/shared/utils/codexConfig.js";

describe("Codex feature flag migration", () => {
  it("renames deprecated codex_hooks to hooks", () => {
    const config = { features: { codex_hooks: true } };
    expect(migrateCodexFeatureFlags(config)).toBe(config);
    expect(config.features).toEqual({ hooks: true });
  });

  it("preserves an explicit hooks value and removes codex_hooks", () => {
    const config = { features: { codex_hooks: true, hooks: false } };
    migrateCodexFeatureFlags(config);
    expect(config.features).toEqual({ hooks: false });
  });
});
