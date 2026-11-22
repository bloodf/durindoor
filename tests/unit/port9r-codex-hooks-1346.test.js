import { expect, it } from "vitest";
import { migrateCodexFeatureFlags } from "../../src/shared/utils/codexConfig.js";

it("migrates deprecated hooks while preserving an explicit replacement", () => {
  expect(migrateCodexFeatureFlags({ features: { codex_hooks: true } })).toEqual({ features: { hooks: true } });
  expect(migrateCodexFeatureFlags({ features: { codex_hooks: true, hooks: false } })).toEqual({ features: { hooks: false } });
});
