# OmniRoute Simple Provider Runtime Hooks

Simple provider registry entries can rely on generic dashboard runtime hooks when
their transport follows an OpenAI-compatible or Claude-compatible shape.

- `modelsFetcher.type: "openai"` uses the `openai` suggested-models filter. It
  normalizes `/models` responses into `{ id, name, contextLength }` values for
  provider detail pages.
- API-key validation and saved-connection tests share the registry probe helper
  in `src/app/api/providers/providerProbe.js`. OpenAI-format providers probe
  `validateUrl` or `/models` first and fall back to a minimal chat request;
  Claude-format providers post a one-token `/messages` request with registry
  auth headers and `urlSuffix` applied.
- Providers with SVG-only copied assets should set `display.iconUrl` to the
  served `/providers/<id>.svg` path so dashboard cards do not fall back to the
  default `.png` lookup.
- Registries with a `{accountId}` URL placeholder (e.g. Snowflake) need
  `providerSpecificData` passed into `probeRegistryProvider`/
  `buildRegistryProviderProbe` so the placeholder resolves before the probe
  fires; both the connection-test route and the validate route do this.
  `normalizeAccountIdPlaceholder` (`open-sse/executors/default.js`) normalizes
  underscores to hyphens before DNS-label validation (Snowflake's documented
  "dashed" hostname variant).
- When a registry's declared `supportsVision`/`supportsReasoning` disagrees
  with the generic model-id glob pattern in `open-sse/providers/capabilities.js`,
  add a `PROVIDER_CAPABILITIES[provider][model]` override rather than
  widening the pattern.
