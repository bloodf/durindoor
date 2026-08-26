# Model Display Metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add readable model/provider metadata to model discovery and internal selection while preserving every existing callable model reference and routing behavior.

**Architecture:** Extend existing registry metadata and normalize it through one pure projection helper. Model-list, model-info, and internal selection consume the same projection; routing continues using existing IDs, aliases, and upstream IDs.

**Tech Stack:** JavaScript, Next.js route handlers, existing provider registry, Vitest.

## Global Constraints

- Existing `/v1/models` `id` and `owned_by` values remain byte-for-byte unchanged.
- Existing harness configuration requires no migration or rewrite.
- Friendly names never become implicit routing aliases.
- Existing `modelAliases`, combos, policies, defaults, provider aliases, and `upstreamModelId` semantics remain unchanged.
- Reuse registry `display.name`, model `name`, and existing `deriveModelName()` fallback.
- No second model catalog and no new dependency.
- Do not modify `tests/__baseline__/known-fails.txt`.

---

### Task 1: Canonical presentation projection

**Files:**
- Create: `open-sse/providers/models/presentation.js`
- Modify: `open-sse/providers/schema.js`
- Modify: `open-sse/providers/registry/codex.js`
- Test: `tests/unit/model-display-metadata-routes.test.js`

**Interfaces:**
- `projectModelPresentation({ model, modelId, providerId, outputAlias })` returns `{ name, provider_name, provider_alias, gateway_provider }`.
- Registry providers may declare `modelProviderName`.

- [ ] Write failing route-level tests for Codex metadata, custom model names, and missing-name fallback.
- [ ] Run `cd tests && npx vitest run --config vitest.config.js unit/model-display-metadata-routes.test.js`; expect missing metadata.
- [ ] Implement pure projection from normalized model and raw registry display metadata.
- [ ] Add `modelProviderName: "OpenAI"` to Codex; normalize its model label to `GPT-5.6 Sol`.
- [ ] Run the focused test; expect pass.

### Task 2: Additive model discovery metadata

**Files:**
- Modify: `src/app/api/v1/models/buildModelsList.js`
- Modify: `src/app/api/v1/models/info/route.js`
- Test: `tests/unit/model-list-display-metadata.test.js`
- Test: existing model-list compatibility suites

**Interfaces:**
- `/v1/models` retains standard fields and adds presentation fields.
- `/v1/models/info` returns matching presentation fields.

- [ ] Write a failing regression that snapshots pre-change `id`/`owned_by` and asserts new metadata for `cx/gpt-5.6-sol`.
- [ ] Add tests for active-connection/static fallback paths and `/v1/models/info` consistency.
- [ ] Run focused tests; expect missing metadata while old identity assertions pass.
- [ ] Apply `projectModelPresentation` at each model-row construction seam without altering `id` or `owned_by` expressions.
- [ ] Run focused and existing model-list tests; expect pass.

### Task 3: Documentation and verification

**Files:**
- Modify: `docs/reference/api.md`
- Modify: `CHANGELOG.md`

- [ ] Document optional model-list metadata and the stable-ID compatibility guarantee.
- [ ] Run focused model metadata, model-list, and info tests.
- [ ] Run `cd tests && BASELINE_BASE_REF=origin/main npm run test:ci` under Node 20.
- [ ] Run `npm run lint`, `npm run check:docs`, `npm run check:registry-index`, and `npm run check:agent-index`.
- [ ] Validate commit and PR title with commitlint.
