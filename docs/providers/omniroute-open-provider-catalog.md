# OmniRoute Open Provider Catalog Ports

This note records the provider-facing scope reviewed from the current open OmniRoute provider PR set.

## Ported

- OmniRoute PR #6410: added `hcnsec`, the Huancheng Public API, as an OpenAI-compatible API-key provider. DurinDoor keeps it live-catalog first with `modelsFetcher`, `passthroughModels`, and no static seed models.
- OmniRoute PR #6311: API-key connection creation now defaults to the first unused name in the `main`, `main-2`, `main-3`, ... sequence based on existing connection names, not the raw connection count. DurinDoor still keeps the backend name-based upsert behavior, but the add-connection modal no longer silently reuses an existing default name, and connection-list refreshes while the modal is open do not wipe in-progress input.

## Already Covered

- OmniRoute PR #6373: DigitalOcean provider metadata is already present from DurinDoor PR #52, including native Claude auth, Responses routing for GPT 5.x models, model discovery, and unit coverage.
- OmniRoute PR #6126: ClinePass already exists in DurinDoor as an OAuth/API-key provider with Cline auth headers, token refresh wiring, model discovery, and thinking configuration.
- OmniRoute PR #6317: DurinDoor already serves local provider images from `public/providers` and uses those paths throughout provider, media, usage, and CLI UI surfaces. The upstream bulk SVG replacement is not needed for this JS registry port.
- OmniRoute PR #6431: DurinDoor's passthrough provider page already adds arbitrary model IDs through custom model rows instead of auto-generating model aliases from the final path segment. The colliding generated-alias path from OmniRoute is not present in this JS implementation.

## Skipped

- OmniRoute PR #6337: GLHF is not present in DurinDoor's provider registry, so there is no provider catalog entry to remove.
- OmniRoute PR #6330: SenseNova is not present in DurinDoor's provider registry, so the Token Plan endpoint and model metadata have no local target entry.
- OmniRoute PR #6351: GLM team-plan quota support spans quota API headers, provider-specific connection fields, add/edit connection UI, validation, and usage parsing. DurinDoor has GLM quota polling, but not the same provider-specific data/UI split; extracting only constants would not make team quota work.
- OmniRoute PR #6349: Tinyfish fetch support adds a web-fetch executor, handler, MCP schema, provider validation, and specialty-media catalog entries. DurinDoor has no matching Tinyfish provider entry to update narrowly in this catalog port.
- OmniRoute PR #6336: Spark quota isolation changes Codex quota persistence and quota UI ordering, not provider catalog metadata.
- OmniRoute PR #6318: the PR adds new CLI tools and route handlers, but no provider-facing DurinDoor catalog setting that can be ported independently.
- OmniRoute PR #6308: web model discovery is implemented upstream across split discovery modules and Kimi/Qwen web executors. DurinDoor still uses a monolithic JS model-discovery route and does not have the same split surface for a safe narrow port.
- OmniRoute PR #6118: `zed-hosted` requires a dedicated executor, OAuth native-app login, and model-resolution runtime. DurinDoor PR #65 already covers the local Zed provider metadata, and the hosted aggregator is too broad for this provider-catalog slice.
- OmniRoute PR #6137: the provider-node icon URL and plugin-manifest work depends on a broader provider-node/schema surface that DurinDoor does not currently have as a narrow preset-only hook.
- OmniRoute PR #6042: provider manifest client is a broad sidecar/plugin-manifest branch with docs, routes, manifest config, and provider-node schema work; no isolated provider-node preset is safe to extract here.
- OmniRoute PR #6040: provider-model performance snapshots alter routing, manifests, executors, package metadata, and generated docs; it is outside this provider-catalog slice.
- OmniRoute PR #6029: Cliproxy model mapping changes proxy dispatch and shared routing internals across a large branch; it is outside this provider-catalog slice.
