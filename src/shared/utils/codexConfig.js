import { isRecord } from "./typeChecks.js";

/** Migrate the deprecated Codex feature flag when writing an existing config. */
export function migrateCodexFeatureFlags(config) {
  const features = config?.features;
  if (!isRecord(features) || !Object.hasOwn(features, "codex_hooks")) return config;
  if (!Object.hasOwn(features, "hooks")) features.hooks = features.codex_hooks;
  delete features.codex_hooks;
  return config;
}
