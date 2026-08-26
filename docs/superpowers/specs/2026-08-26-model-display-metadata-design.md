# Model Display Metadata Design

## Goal

Give humans and capable harnesses readable model and provider names without changing any callable model reference or routing behavior.

## Domain terms

- **Model ID:** provider-local routing identity, for example `gpt-5.6-sol`.
- **Model reference:** stable callable value, for example `cx/gpt-5.6-sol`.
- **Model name:** human-readable label, for example `GPT-5.6 Sol`.
- **Provider alias:** routing namespace, for example `cx`.
- **Model provider:** maker or publisher, for example `OpenAI`.
- **Gateway provider:** DurinDoor access channel, for example `OpenAI Codex`.

The word `alias` continues to mean an existing routing alias. A model name is never an alias.

## Backward compatibility

This change is additive. Existing model references remain byte-for-byte identical. DurinDoor does not rewrite saved harness configuration, model defaults, combo members, API-key policies, custom aliases, or `modelAliases` records.

For every preexisting `/v1/models` entry:

- `id` remains unchanged.
- `owned_by` remains unchanged.
- Routing continues to use `id`, provider aliases, model IDs, and `upstreamModelId` exactly as before.
- Harnesses that ignore unknown fields behave exactly as before.

Friendly names never replace `id` and are never accepted as implicit routing aliases.

## Additive model-list fields

A static `cx/gpt-5.6-sol` row becomes:

```json
{
  "id": "cx/gpt-5.6-sol",
  "object": "model",
  "owned_by": "cx",
  "name": "GPT-5.6 Sol",
  "provider_name": "OpenAI",
  "provider_alias": "cx",
  "gateway_provider": "OpenAI Codex"
}
```

Field meanings:

- `name`: canonical model display name.
- `provider_name`: model maker or publisher.
- `provider_alias`: callable reference prefix.
- `gateway_provider`: configured DurinDoor provider display name.

OpenAI-compatible standard fields stay intact. New fields are optional extensions.

## Metadata sources

Use existing registry metadata as the single source:

- Model name: normalized model `name`; missing names use existing `deriveModelName(id)` behavior.
- Gateway provider: registry `display.name`.
- Provider alias: the exact output alias used in the callable model reference.
- Model provider: provider-level `modelProviderName` when declared, otherwise registry `display.name`.

Codex declares `modelProviderName: "OpenAI"`; its gateway display remains `OpenAI Codex`.

## Projection module

A small pure projection helper accepts the existing model entry plus provider metadata and returns additive presentation fields. Both `/v1/models` and `/v1/models/info` use it. The helper does not resolve, normalize, or mutate routing identities.

Static catalogs, active-connection catalogs, and static fallback catalogs use the same projection. Custom/live model rows use their supplied `name` or the existing derived fallback. Combos keep their callable IDs and `owned_by: "combo"`; combo names remain their existing saved names.

## Internal display compatibility

Existing DurinDoor selectors already render registry model `name` while storing and submitting the callable model reference. This change does not add a second selector/search metadata pipeline and does not alter persisted values.

## Verification

- Regression snapshot proves `id` and `owned_by` are unchanged while metadata is added.
- `cx/gpt-5.6-sol` projects to `GPT-5.6 Sol`, `OpenAI`, `cx`, and `OpenAI Codex`.
- `/v1/models/info` returns the same naming metadata.
- Custom models preserve their persisted display `name` and use their registry provider's presentation metadata.
- Missing model names use `deriveModelName(id)`.
- Existing model references still resolve and route to the same provider/model/upstream ID.
- Dashboard selection stores and submits the callable `id`, not `name`.
