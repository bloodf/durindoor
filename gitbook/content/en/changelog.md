# Changelog

## 2026-07-09 — Per-API-key policy controls

DurinDoor now lets you restrict each API key independently from **Settings > API Keys**:

- **Allowed models** — limit a key to a specific model allowlist; requests using any other model are rejected.
- **Lifetime token limit** — block a key once its cumulative token usage reaches the cap.
- **Lifetime cost limit** — block a key once its cumulative cost reaches the cap.

When a limit is reached, requests receive a `429` rate-limit response. Usage is counted across all SSE endpoints, including chat, embeddings, image generation, TTS, STT, and search. The dashboard shows each key's remaining budget and current lifetime totals.

**Fork note:** DurinDoor keeps the existing `allowedCombos` and `dailyLimitTokens` fields from prior migrations. This feature is delivered as migration `005` (not upstream's `002`) so both old and new policy controls can coexist.
