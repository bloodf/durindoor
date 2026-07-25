# Model Catalog 1M Corrections Design

**Date:** 2026-07-25<br>
**Status:** Approved scope<br>
**Target branch:** `feat/model-catalog-1m-corrections`, based on `origin/main`

## Purpose

Correct DurinDoor's Anthropic and OpenAI model catalogs, Claude Code routing defaults, and context/capability metadata so recently released 1M-class models resolve with the values users expect.

The change must be source-backed, provider-scoped, and covered by focused tests. It must not turn the repository README into a model catalog.

## Confirmed facts

### Anthropic

Anthropic's current model documentation confirms:

| Model | API ID | Context | Max output | Thinking |
| --- | --- | ---: | ---: | --- |
| Claude Fable 5 | `claude-fable-5` | 1,000,000 | 128,000 | adaptive |
| Claude Opus 5 | `claude-opus-5` | 1,000,000 | 128,000 | adaptive |
| Claude Sonnet 5 | `claude-sonnet-5` | 1,000,000 | 128,000 | adaptive |
| Claude Opus 4.8 | `claude-opus-4-8` | 1,000,000 | 128,000 | adaptive |
| Claude Opus 4.7 | `claude-opus-4-7` | 1,000,000 | 128,000 | adaptive |
| Claude Opus 4.6 | `claude-opus-4-6` | 1,000,000 | 128,000 | adaptive |
| Claude Sonnet 4.6 | `claude-sonnet-4-6` | 1,000,000 | 128,000 | adaptive |

Anthropic documents 1M as the default for those models; no beta header is required.

Claude Code's model configuration resolves the Anthropic API `opus` alias to Opus 5 and the Anthropic API `sonnet` alias to Sonnet 5. It also documents `opus[1m]` and `sonnet[1m]` as explicit long-context aliases. Opus 5 requires Claude Code v2.1.219 or later; Sonnet 5 requires v2.1.197 or later.

Sources:

- `https://docs.anthropic.com/en/about-claude/models`
- `https://docs.anthropic.com/en/build-with-claude/context-windows`
- `https://code.claude.com/docs/en/model-config`

### OpenAI

OpenAI's model catalog confirms the GPT-5.6 family at 1,050,000 input tokens and 128,000 max output tokens. The `gpt-5.6` alias routes to `gpt-5.6-sol`.

| Model | API ID | Context | Max output |
| --- | --- | ---: | ---: |
| GPT-5.6 alias | `gpt-5.6` | 1,050,000 | 128,000 |
| GPT-5.6 Sol | `gpt-5.6-sol` | 1,050,000 | 128,000 |
| GPT-5.6 Terra | `gpt-5.6-terra` | 1,050,000 | 128,000 |
| GPT-5.6 Luna | `gpt-5.6-luna` | 1,050,000 | 128,000 |

OpenAI also documents 1,050,000 input tokens and 128,000 output tokens for `gpt-5.5`.

Sources:

- `https://developers.openai.com/api/docs/models`
- `https://developers.openai.com/api/docs/models/gpt-5.6-sol`
- `https://developers.openai.com/api/docs/models/gpt-5.6-terra`
- `https://developers.openai.com/api/docs/models/gpt-5.6-luna`
- `https://developers.openai.com/api/docs/models/gpt-5.5`
- `https://developers.openai.com/api/docs/guides/latest-model`

### Kiro

DurinDoor's Kiro descriptor currently advertises `contextLength: 272000` for GPT-5.6 Sol/Terra/Luna. The user explicitly approved changing Kiro to the OpenAI-documented 1,050,000 context as well. The implementation will update the shared descriptor, capability resolution, and tests, while keeping Kiro's existing max-output behavior at 32,000 unless a provider-specific source proves a different Kiro output ceiling.

## Current problems

1. `open-sse/providers/registry/claude.js` omits `claude-opus-5`; Claude Code's default Opus route still points to `cc/claude-opus-4-8`.
2. `open-sse/providers/registry/anthropic.js` exposes only older Claude 4/3.5 models and omits current Opus 5, Sonnet 5, Fable 5, and Haiku 4.5.
3. `open-sse/providers/capabilities.js` has no exact Opus 5 capability row, so it can inherit the older generic Claude budget pattern and 200k context floor.
4. Direct OpenAI and Codex GPT-5.6 models match the generic `*gpt-5*` pattern at 400k/128k instead of OpenAI's documented 1.05M/128k.
5. `src/shared/constants/cliTools.js` does not expose Claude Code's documented `opus[1m]` or `sonnet[1m]` aliases.
6. Existing tests pin some stale values, including Kiro's previous 272k metadata and direct Codex GPT-5.6's 400k fallback.

## Design

### Catalog entries

- Add `{ id: "claude-opus-5", name: "Claude Opus 5" }` to `open-sse/providers/registry/claude.js`, ordered before Sonnet 5 and legacy Opus entries.
- Refresh `open-sse/providers/registry/anthropic.js` with current entries first:
  - `claude-opus-5`
  - `claude-sonnet-5`
  - `claude-fable-5`
  - `claude-haiku-4-5-20251001`
- Keep existing Anthropic legacy entries after the current entries so saved model IDs remain valid.
- Do not add OpenAI GPT-5.6 catalog entries; `open-sse/providers/registry/openai.js` already contains `gpt-5.6`, Sol, Terra, and Luna.

### Claude Code defaults and aliases

- Change Claude Code's default Opus mapping in `src/shared/constants/cliTools.js` from `cc/claude-opus-4-8` to `cc/claude-opus-5`.
- Keep Sonnet at `cc/claude-sonnet-5`, Fable at `cc/claude-fable-5`, and Haiku at `cc/claude-haiku-4-5-20251001`.
- Add `opus[1m]` and `sonnet[1m]` to the Claude tool's model alias list.
- Add default-model rows for those aliases only if the dashboard mapping UI requires a row to expose them; otherwise alias recognition alone is enough. Keep both aliases mapped to the same current native-1M models because Anthropic does not require a separate beta model ID.
- Do not translate `opus[1m]` or `sonnet[1m]` into nonexistent model IDs. If a settings route needs to persist them, preserve the documented alias text.

### Capability metadata

- Add exact `MODEL_CAPABILITIES` rows for `claude-opus-5` and the synthetic thinking variant only if such a variant is actually exposed by a registry. The row must resolve to:
  - `vision: true`
  - `reasoning: true`
  - `search: true`
  - `thinkingFormat: "claude-adaptive"`
  - `contextWindow: 1000000`
  - `maxOutput: 128000`
- Add Claude 5 patterns before the older Claude budget patterns so dash/dot forms and future suffixes inherit adaptive thinking and the 1M/128k limits.
- Add exact OpenAI capability rows or provider-scoped overrides for direct `openai` and `codex`/`cx` GPT-5.6 IDs so those surfaces resolve to `contextWindow: 1050000` and `maxOutput: 128000`.
- Change `gpt-5.5` direct capability resolution from 400000 to OpenAI's documented 1050000 while preserving existing reasoning/search/vision behavior.
- Change `KIRO_GPT_5_6_FAMILY` contextLength to 1050000 for Sol, Terra, and Luna. Preserve tier rate multipliers and Kiro's 32000 max-output provider capability.
- Keep provider precedence: Kiro's rows must not accidentally rewrite direct OpenAI or Codex behavior.

### Tests

Update or add focused tests that defend observable contracts:

- Anthropic and Claude Code catalogs expose Opus 5 while legacy entries remain present.
- Claude Code default Opus mapping resolves to `cc/claude-opus-5`.
- Claude Code alias list includes `opus[1m]` and `sonnet[1m]`.
- Opus 5 capability resolution returns 1,000,000/128,000 adaptive-thinking metadata across relevant provider spellings.
- Direct OpenAI GPT-5.6 alias/Sol/Terra/Luna resolve to 1,050,000/128,000.
- Codex GPT-5.6 synthetic forms resolve to 1,050,000/128,000 on direct Codex surfaces.
- Kiro GPT-5.6 variants resolve to 1,050,000 context and 32,000 max output.
- Existing Kiro normalization (`gpt-5-6-sol` to `gpt-5.6-sol`) still resolves to the same provider row.
- GPT-5.5 direct capability resolution returns 1,050,000 context.
- Documentation checker remains green.

Do not add live-provider tests. The authoritative docs and static capability resolution are enough for this metadata correction.

### Documentation

Add a short provider-catalog note documenting:

- Claude Opus 5 is available and Claude Code's Opus default points to it.
- Anthropic Opus/Sonnet 1M models are native; no beta header is required.
- OpenAI GPT-5.6 and GPT-5.5 resolve to 1.05M context on direct OpenAI/Codex surfaces.
- Kiro GPT-5.6 follows the approved 1.05M catalog correction in this change.

The primary README must not be edited by this branch.

## Verification

Run the focused tests that cover the touched contracts, then the repository CI test command if the focused tests pass:

1. Focused catalog/capability tests under `tests/unit/` and any touched translator tests.
2. `npm run check:docs`.
3. `cd tests && npm run test:ci`.
4. `npx commitlint --from=origin/main --to=HEAD` before any push.

The baseline file `tests/__baseline__/known-fails.txt` must not gain entries.

## Acceptance criteria

- Claude Code and Anthropic catalogs expose Claude Opus 5.
- Claude Code's default Opus model is `cc/claude-opus-5`.
- `opus[1m]` and `sonnet[1m]` are recognized Claude Code aliases.
- Opus 5 resolves to native 1M/128k adaptive-thinking capabilities.
- Anthropic Sonnet 5, Fable 5, Opus 4.8, Opus 4.7, Opus 4.6, and Sonnet 4.6 keep native 1M/128k metadata.
- OpenAI GPT-5.6 alias/Sol/Terra/Luna and GPT-5.5 resolve to 1.05M/128k on direct OpenAI/Codex surfaces.
- Kiro GPT-5.6 Sol/Terra/Luna resolve to 1.05M context while retaining Kiro's 32k max-output behavior.
- Focused tests, docs integrity, repository test gate, and commitlint pass.
