# Claude `stream_options` Transport Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent OpenAI-only `stream_options` from reaching Anthropic Messages transports while preserving usage chunks on runtime-selected OpenAI transports.

**Architecture:** Keep injection at the executor boundary, where the actual runtime transport is known. Normalize `credentials.runtimeTransport.format` by removing a trailing `-apikey`, fall back to provider config, and gate injection on exact `openai` format.

**Tech Stack:** JavaScript, Vitest, existing DefaultExecutor and provider registry.

## Global Constraints

- No new dependency or provider-specific strip list.
- Preserve existing OpenAI-compatible usage behavior from decolua/9router#3081.
- Add documentation and behavior tests per `AGENTS.md`.
- Do not modify `tests/__baseline__/known-fails.txt`.

---

### Task 1: Transport-aware usage option injection

**Files:**
- Modify: `open-sse/executors/default.js:282-343`
- Modify: `tests/unit/default-executor-stream-usage.test.js`
- Create: `docs/superpowers/specs/2026-08-11-claude-stream-options-design.md`

**Interfaces:**
- Consumes: `credentials.runtimeTransport.format?: string`, `this.config.format?: string`.
- Produces: transformed request body with `stream_options.include_usage` only for effective `openai` transports.

- [ ] **Step 1: Add failing transport tests**

Add cases proving direct Claude and runtime-selected Claude omit `stream_options`, while runtime-selected `openai` and `openai-apikey` retain injection.

- [ ] **Step 2: Verify red**

Run `cd tests && ./node_modules/.bin/vitest run --config vitest.config.js unit/default-executor-stream-usage.test.js`.

Expected: direct-Claude and runtime-Claude assertions fail because current code injects `{ include_usage: true }`.

- [ ] **Step 3: Add minimum production guard**

In `DefaultExecutor.transformRequest`, compute:

```js
const transportFormat = credentials?.runtimeTransport?.format?.replace(/-apikey$/, "") || this.config.format;
```

Require `transportFormat === "openai"` in the existing stream usage injection condition.

- [ ] **Step 4: Verify green and gates**

Run the focused test, `cd tests && BASELINE_BASE_REF=2e0477617 npm run test:ci`, `npm run lint`, `npm run check:docs`, `npm run build`, commitlint, and PR-title commitlint.

- [ ] **Step 5: Commit and open PR**

Commit as `fix(claude): keep OpenAI stream options off Messages requests`; open a PR to `main` with exact reproduction, test, documentation, baseline, and compatibility evidence.
