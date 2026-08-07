export function migrateCodexFeatureFlags(config) {
  if (!config || typeof config !== "object") return config;
  const features = config.features;
  if (!features || typeof features !== "object" || !Object.hasOwn(features, "codex_hooks")) return config;
  if (!Object.hasOwn(features, "hooks")) features.hooks = features.codex_hooks;
  delete features.codex_hooks;
  return config;
}
