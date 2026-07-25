# Model Catalog 1M Corrections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Claude Opus 5 and source-confirmed 1M context metadata for Anthropic, OpenAI, Codex, and Kiro surfaces without breaking existing provider-scoped behavior.

**Architecture:** Keep provider registries as the catalog source and `open-sse/providers/capabilities.js` as the capability fallback chain. Make the smallest exact rows/pattern updates needed, update the Kiro descriptor once, and prove behavior through existing focused Vitest files. Documentation gets one scoped note; README stays untouched.

**Tech Stack:** JavaScript ES modules, Vitest, Next.js route tests, repository docs checker.

## Global Constraints

- Work on `feat/model-catalog-1m-corrections`, based on `origin/main`; never edit the dirty primary checkout or another worktree.
- Do not edit `README.md`, `package-lock.json`, generated `open-sse/providers/registry/index.js`, `tests/__baseline__/known-fails.txt`, or user data.
- Do not add dependencies, live-provider calls, or a new abstraction layer.
- Preserve provider-specific capability precedence: provider override, exact model row, pattern, default.
- Keep existing legacy Anthropic model IDs valid.
- Keep Kiro GPT-5.6 rate multipliers and 32,000 max-output capability while changing its context metadata to the user-approved 1,050,000.
- Every behavior change gets focused test coverage.

---

### Task 1: Correct catalogs, defaults, aliases, and capabilities

**Files:**
- Modify: `open-sse/providers/registry/claude.js`
- Modify: `open-sse/providers/registry/anthropic.js`
- Modify: `open-sse/providers/capabilities.js`
- Modify: `open-sse/providers/models/kiroVariants.js`
- Modify: `src/shared/constants/cliTools.js`
- Test: `tests/unit/capabilities.test.js`
- Test: `tests/unit/capabilities-context-window.test.js`
- Test: `tests/unit/capabilities-opus-context.test.js`
- Test: `tests/unit/claude-settings-post.test.js`
- Test: `tests/unit/kiro-model-slots.test.js`
- Test: `tests/unit/combo-capabilities.test.js`

**Interfaces:**
- Consumes: first-party Anthropic and OpenAI model values recorded in `docs/superpowers/specs/2026-07-25-model-catalog-1m-corrections-design.md`.
- Produces: corrected `PROVIDER_MODELS`, `CLI_TOOLS.claude`, `MODEL_CAPABILITIES`, `PATTERN_CAPABILITIES`, `PROVIDER_CAPABILITIES`, and `KIRO_GPT_5_6_FAMILY` values used by routing, dashboard model mapping, and capability resolution.

- [ ] **Step 1: Add failing catalog/default/alias expectations**

Update `tests/unit/claude-settings-post.test.js`:

- Change the existing default Opus expectation from `cc/claude-opus-4-8` to `cc/claude-opus-5` in both input and expected persisted value.
- Add a test that `CLI_TOOLS.claude.modelAliases` contains `opus[1m]` and `sonnet[1m]`.
- Add a test that `CLI_TOOLS.claude.defaultModels` maps `opus` to `cc/claude-opus-5` while keeping `sonnet`, `fable`, and `haiku` unchanged.

Add a focused catalog assertion in an existing appropriate unit file, or create `tests/unit/anthropic-claude-catalog.test.js` if no existing catalog test owns these registries:

```js
import { describe, expect, it } from "vitest";
import { PROVIDER_MODELS } from "../../open-sse/providers/index.js";

describe("Anthropic and Claude Code model catalogs", () => {
  it("exposes Claude Opus 5 and keeps legacy Claude entries", () => {
    const ccIds = (PROVIDER_MODELS.cc || []).map((model) => model.id);
    const anthropicIds = (PROVIDER_MODELS.anthropic || []).map((model) => model.id);

    expect(ccIds).toContain("claude-opus-5");
    expect(ccIds).toContain("claude-opus-4-8");
    expect(ccIds).toContain("claude-opus-4-7");

    expect(anthropicIds).toEqual(expect.arrayContaining([
      "claude-opus-5",
      "claude-sonnet-5",
      "claude-fable-5",
      "claude-haiku-4-5-20251001",
      "claude-opus-4-20250514",
      "claude-sonnet-4-20250514",
      "claude-3-5-sonnet-20241022",
    ]));
  });
});
```

Run the focused files and confirm the new expectations fail before production edits.

- [ ] **Step 2: Add failing capability expectations**

Update existing capability tests rather than adding parallel suites:

- In `tests/unit/capabilities-opus-context.test.js`, add `claude-opus-5` to the 1M/128k adaptive-thinking model set and assert older `claude-opus-4-5-20251101` remains 200k.
- In `tests/unit/capabilities-context-window.test.js`, replace stale direct-surface expectations:
  - `openai/gpt-5.5` → 1,050,000
  - `codex/gpt-5.6-sol-ultra` → 1,050,000
  - add `openai/gpt-5.6`, `openai/gpt-5.6-sol`, `openai/gpt-5.6-terra`, `openai/gpt-5.6-luna`, and `cx/gpt-5.6-sol-review` → 1,050,000
- In `tests/unit/capabilities.test.js`, change `kiroGpt56Expected.contextWindow` from 272000 to 1050000 and update comments/test names from “272k” to “1.05M”.
- In `tests/unit/kiro-model-slots.test.js`, update MITM slot context expectations to 1050000 and generated-description assertions from `272k context window` to `1.05M context window`.
- In `tests/unit/combo-capabilities.test.js`, update Kiro combo context expectations from 272000 to 1050000 while keeping maxOutput 32000 and `thinkingFormat: "kiro"`.

Run these focused files and confirm failures identify the missing/stale production values.

- [ ] **Step 3: Apply minimal production changes**

`open-sse/providers/registry/claude.js`:

```js
models: [
  { id: "claude-opus-5", name: "Claude Opus 5" },
  { id: "claude-fable-5", name: "Claude Fable 5" },
  { id: "claude-sonnet-5", name: "Claude Sonnet 5" },
  { id: "claude-opus-4-8", name: "Claude Opus 4.8" },
  { id: "claude-opus-4-7", name: "Claude Opus 4.7" },
  { id: "claude-haiku-4-5-20251001", name: "Claude 4.5 Haiku" },
],
```

`open-sse/providers/registry/anthropic.js`:

```js
models: [
  { id: "claude-opus-5", name: "Claude Opus 5" },
  { id: "claude-sonnet-5", name: "Claude Sonnet 5" },
  { id: "claude-fable-5", name: "Claude Fable 5" },
  { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5" },
  { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4" },
  { id: "claude-opus-4-20250514", name: "Claude Opus 4" },
  { id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet" },
],
```

`src/shared/constants/cliTools.js`:

- In `CLI_TOOLS.claude.modelAliases`, include `opus[1m]` and `sonnet[1m]`.
- Change the `opus` defaultValue to `cc/claude-opus-5`.
- Leave Sonnet, Fable, and Haiku defaults unchanged.

`open-sse/providers/capabilities.js`:

- Add an exact row for `claude-opus-5` matching the existing Claude 5 shape: vision/reasoning/search true, `thinkingFormat: "claude-adaptive"`, `contextWindow: 1000000`, `maxOutput: 128000`.
- Add ordered Claude 5 patterns before older budget patterns so Opus/Sonnet 5 variants inherit adaptive thinking and 1M/128k without overriding older Haiku behavior.
- Add provider-scoped direct OpenAI and Codex overrides for GPT-5.6 and GPT-5.5 at 1,050,000/128,000. Cover both provider IDs and aliases (`openai`, `codex`, `cx`) if the resolver can receive either.
- Do not change generic `*gpt-5*` pattern behavior for unrelated providers.

`open-sse/providers/models/kiroVariants.js`:

- Change each `KIRO_GPT_5_6_FAMILY.contextLength` to 1050000.
- Change generated descriptions from `272k context window` to `1.05M context window`.
- Preserve IDs, names, rate multipliers, and variant generation.

- [ ] **Step 4: Run focused tests until green**

Run:

```bash
npx vitest run --config tests/vitest.config.js \
  tests/unit/claude-settings-post.test.js \
  tests/unit/capabilities.test.js \
  tests/unit/capabilities-context-window.test.js \
  tests/unit/capabilities-opus-context.test.js \
  tests/unit/kiro-model-slots.test.js \
  tests/unit/combo-capabilities.test.js \
  tests/unit/anthropic-claude-catalog.test.js
```

Expected: all focused tests pass. If `anthropic-claude-catalog.test.js` was not created because an existing file owns the assertion, run that owning file instead.

- [ ] **Step 5: Check registry index requirement**

Run:

```bash
npm run check:registry-index
```

Expected: exit `0`. Registry index should not change because no registry file was added or removed.

- [ ] **Step 6: Commit the behavior correction**

Run:

```bash
git add open-sse/providers/registry/claude.js open-sse/providers/registry/anthropic.js open-sse/providers/capabilities.js open-sse/providers/models/kiroVariants.js src/shared/constants/cliTools.js tests/unit
git commit -m "fix(catalog): correct 1m model metadata"
```

Expected: one commit containing production and focused test changes.

---

### Task 2: Document the corrected model behavior

**Files:**
- Modify: `docs/providers/subscription.md`
- Test: `scripts/check-docs.mjs`

**Interfaces:**
- Consumes: corrected catalog/capability behavior from Task 1.
- Produces: user-facing documentation for native 1M Anthropic models, direct OpenAI 1.05M models, and Kiro's approved correction.

- [ ] **Step 1: Add a short provider catalog note**

Append a `### Current 1M model catalog corrections` section under `## Provider Identifiers` in `docs/providers/subscription.md` with these exact facts:

- Claude Code exposes `claude-opus-5`; the dashboard's default Opus mapping points to `cc/claude-opus-5`.
- Anthropic Opus 5, Sonnet 5, Fable 5, Opus 4.8, Opus 4.7, Opus 4.6, and Sonnet 4.6 use a native 1M context window and do not require a beta header.
- Direct OpenAI GPT-5.6 (`gpt-5.6`, Sol, Terra, Luna) and GPT-5.5 resolve with a 1.05M context window and 128k max output.
- Kiro GPT-5.6 Sol/Terra/Luna use the same approved 1.05M catalog context in DurinDoor while keeping Kiro's existing 32k output capability.
- The running `/v1/models` response remains the source of truth for configured connections.

- [ ] **Step 2: Validate docs**

Run:

```bash
npm run check:docs
```

Expected: `Documentation integrity checks passed.`

- [ ] **Step 3: Commit documentation**

Run:

```bash
git add docs/providers/subscription.md
git commit -m "docs(providers): document 1m model corrections"
```

Expected: one docs commit.

---

### Task 3: Run repository verification and finalize branch

**Files:**
- Verify only; no intended modifications.

- [ ] **Step 1: Run the repository test gate**

Run:

```bash
cd tests
npm run test:ci
```

Expected: gate exits `0`; `tests/__baseline__/known-fails.txt` unchanged.

- [ ] **Step 2: Run lint and docs checks**

Run:

```bash
npm run lint
npm run check:docs
npm run check:registry-index
```

Expected: all commands exit `0`.

- [ ] **Step 3: Validate commits**

Run:

```bash
npx commitlint --from=origin/main --to=HEAD
```

Expected: exit `0`.

- [ ] **Step 4: Review final diff**

Run:

```bash
git status --short
git diff --check origin/main...HEAD
git diff --stat origin/main...HEAD
```

Expected: clean worktree, no whitespace errors, and only the approved catalog/test/docs files changed.
