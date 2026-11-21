# #1073 Late June Existing Anthropic Headers, Thinking Budgets, and Reasoning History

Static comparison of four late-June 2026 OmniRoute PRs against current DurinDoor source and offline test inventory. Public commit links identify the reviewed PR heads and integration merges. Where an enclosing merge brings in unrelated release commits, evaluation is strictly scoped to the exact PR diff and its named functional changes. Privacy, security boundaries, and transport behavior are evaluated statically; no live provider traffic, credentials, tokens, or retired models are used.

## Scope and Pinned Changes

The four audited PRs span three distinct architectural domains: normal outbound Anthropic header canonicalization, proxy-level thinking-budget hydration/mode enforcement, and native reasoning history replay, alongside an explicit separation of an inbound source-only opt-out header.

1. **[OmniRoute #4823](https://github.com/cheaper-inference/OmniRoute/pull/4823)**
   - Head: [`da73e318b7ad977652020f9d738fc7310cf6f6fc`](https://github.com/cheaper-inference/OmniRoute/commit/da73e318b7ad977652020f9d738fc7310cf6f6fc)
   - Enclosing merge: [`885134b192a273471a52a02ee36397eef8d788aa`](https://github.com/cheaper-inference/OmniRoute/commit/885134b192a273471a52a02ee36397eef8d788aa)
   - Title: `fix(sse): make anthropic-version default-guard case-insensitive`
   - Scope: Guarding the default assignment of `anthropic-version` in `DefaultExecutor.buildHeaders` against existing Title-Case `Anthropic-Version` headers.

2. **[OmniRoute #4846](https://github.com/cheaper-inference/OmniRoute/pull/4846)**
   - Head: [`17d6b23bde226cccc37b23e09d00f6e5b2e12f55`](https://github.com/cheaper-inference/OmniRoute/commit/17d6b23bde226cccc37b23e09d00f6e5b2e12f55)
   - Enclosing merge: [`f52863c80a81bbfe3eb1923f384573313e2ca20f`](https://github.com/cheaper-inference/OmniRoute/commit/f52863c80a81bbfe3eb1923f384573313e2ca20f)
   - Title: `fix(sse): dedupe case-variant Anthropic version/beta headers`
   - Scope: Comprehensive case-variant canonicalization (`normalizeAnthropicHeaderVariants`) across `BaseExecutor` and `DefaultExecutor` for `anthropic-version` and `anthropic-beta` to prevent undici comma-concatenation errors.

3. **[OmniRoute #5352](https://github.com/cheaper-inference/OmniRoute/pull/5352)**
   - Head: [`085bb494ed692f98ca368525051bcc9c32e41620`](https://github.com/cheaper-inference/OmniRoute/commit/085bb494ed692f98ca368525051bcc9c32e41620) (branch sync commit; PR branch head was `0f3225e88d`)
   - Enclosing merge: [`7592ef16e0fddb63a533611a58e4a8ea1b89b1c0`](https://github.com/cheaper-inference/OmniRoute/commit/7592ef16e0fddb63a533611a58e4a8ea1b89b1c0)
   - Title: `fix(thinking): hydrate budget, honor config in base.ts, redacted_thinking on replay (#5312) (#5352)`
   - Scope: Restoring persisted `settings.thinkingBudget` at server boot (`hydrateThinkingBudgetConfig`), enforcing proxy-level thinking mode in `BaseExecutor` (e.g. `ThinkingMode.AUTO`), and converting assistant `reasoning_content` to signature-less `redacted_thinking` placeholders on Claude replay.

4. **[OmniRoute #5367](https://github.com/cheaper-inference/OmniRoute/pull/5367)**
   - Head: [`0e5287219908cbb9c3f67dd2a64a79f991893e35`](https://github.com/cheaper-inference/OmniRoute/commit/0e5287219908cbb9c3f67dd2a64a79f991893e35) (branch sync commit; PR branch head was `206a8d2104`)
   - Enclosing merge: [`734061f736f62bc95d028fb0d8878e7d023c97be`](https://github.com/cheaper-inference/OmniRoute/commit/734061f736f62bc95d028fb0d8878e7d023c97be)
   - Title: `fix(thinking): header opt-out of </think> marker for reasoning_content clients (#5312 RC-C, #5245) (#5367)`
   - Scope: Adding an inbound, source-only client request header (`x-omniroute-thinking-marker: off|on|keep`) to override User-Agent heuristics and suppress literal `</think>` injection in visible content during streaming translation.

---

## Behavior and Fixture Analysis

### 1. Outbound Header Canonicalization (#4823, #4846)

#### Upstream Mechanism
Upstream discovered that Node/undici's `fetch` lowercases header keys when combining headers from plain JavaScript objects. When an outbound header dictionary contains both Title-Case and lowercase keys for the same HTTP header (for instance, `"Anthropic-Version": "2023-06-01"` and `"anthropic-version": "2023-06-01"`), undici merges them into a comma-delimited list: `"anthropic-version: 2023-06-01, 2023-06-01"`. The Anthropic Messages API strictly rejects duplicate or comma-joined versions with HTTP 400.

- **OmniRoute #4823** attempted a targeted fix in `DefaultExecutor.buildHeaders`:
  ```ts
  const hasAnthropicVersion = Object.keys(headers).some(
    (key) => key.toLowerCase() === "anthropic-version"
  );
  if (!hasAnthropicVersion) {
    headers["anthropic-version"] = "2023-06-01";
  }
  ```
- **OmniRoute #4846** superseded #4823 by recognizing that multiple case variants could already exist in `headers` before default assignment, and that `anthropic-beta` suffered from the same comma-concatenation duplication. It introduced `normalizeAnthropicHeaderVariants(headers)` in `open-sse/config/anthropicHeaders.ts`, called just before return in `BaseExecutor.buildHeaders` and `DefaultExecutor.buildHeaders`:
  - `anthropic-version`: Extracts all unique non-empty comma-separated values across `"anthropic-version"` and `"Anthropic-Version"`, deletes both keys, and sets lowercase `headers["anthropic-version"] = versionValues[0]`.
  - `anthropic-beta`: Extracts, trims, dedupes, and filters non-empty tokens across `"anthropic-beta"` and `"Anthropic-Beta"`, deletes both keys, and sets lowercase `headers["anthropic-beta"] = betaValues.join(",")`.

#### Current Local DurinDoor Implementation
In DurinDoor:
- `open-sse/providers/shared.js:58,95` exports `CLAUDE_API_HEADERS` and `CLAUDE_CLI_SPOOF_HEADERS` with Title-Case keys (`"Anthropic-Version"` and `"Anthropic-Beta"`).
- `open-sse/executors/base.js:237` checks:
  ```js
  if (!headers["anthropic-version"]) {
    headers["anthropic-version"] = ANTHROPIC_API_VERSION;
  }
  ```
- `open-sse/executors/default.js:219, 226` checks:
  ```js
  if (desc.anthropicVersion && !headers["anthropic-version"]) {
    headers["anthropic-version"] = ANTHROPIC_API_VERSION;
  }
  ```
- In `open-sse/executors/default.js:731-772`, different branches check `anthropic-beta` and `Anthropic-Beta` conditionally, but line 772 sets `headers["Anthropic-Beta"]`, while line 745 can delete or overwrite individual keys.
- Neither `open-sse/executors/base.js` nor `open-sse/executors/default.js` executes case-insensitive deduplication or key-case collapsing prior to dispatch.
- Existing local tests such as `tests/unit/port-4752-anthropic-identity.test.js` assert presence of `headers["Anthropic-Beta"]`, while `tests/unit/github-claude-messages.test.js` asserts `headers["anthropic-version"]`.

#### Disposition and Demonstrated Gap
- **OmniRoute #4823**: **Superseded by #4846 / Unresolved narrow gap**. The targeted check in #4823 was an intermediate step; the comprehensive normalization in #4846 addresses the root cause across both `anthropic-version` and `anthropic-beta`.
- **OmniRoute #4846**: **Demonstrated narrow gap**. When provider configuration, runtime transport headers, or client headers supply differing casing variants, DurinDoor's outbound headers object can retain both Title-Case and lowercase entries. Under Node/undici `fetch`, this produces invalid comma-joined headers that Anthropic upstreams reject.

#### Ordinary Offline Acceptance
Add an offline unit test to `tests/unit/` (e.g. `tests/unit/anthropic-header-case-canonicalization.test.js`):
1. Initialize `DefaultExecutor` and `BaseExecutor` with credentials/config specifying Title-Case headers (`{"Anthropic-Version": "2023-06-01", "Anthropic-Beta": "interleaved-thinking-2025-05-14"}`).
2. Invoke `buildHeaders()` with client options or runtime headers containing lowercase variants (`{"anthropic-version": "2023-06-01", "anthropic-beta": "oauth-2025-04-20"}`).
3. Assert that the resulting headers object contains only canonical lowercase `"anthropic-version"` and `"anthropic-beta"` keys, that the version value is a single string without comma pollution (`assert.ok(!headers["anthropic-version"].includes(","))`), that beta flags are deduplicated into a single comma-delimited string, and that uppercase keys are completely deleted.

---

### 2. Thinking-Budget Hydration and Base Executor Enforcement (#5352 Part A)

#### Upstream Mechanism
Upstream OmniRoute implemented a proxy-level thinking budget subsystem (`open-sse/services/thinkingBudget.ts`) featuring global operating modes (`auto`, `passthrough`, `custom`, `adaptive`).
- **Hydration at Boot**: `settings.thinkingBudget` is persisted in the database via the dashboard settings API. In #5352, upstream added `hydrateThinkingBudgetConfig(settings)` in `src/server-init.ts` because server restart previously lost operator settings and defaulted to `passthrough`.
- **BaseExecutor Enforcement**: In `open-sse/executors/base.ts`, if `getThinkingBudgetConfig().mode === ThinkingMode.AUTO`, upstream strips `thinking`, `context_management`, and `output_config` from Claude requests to let the provider decide. If `thinking.type === "enabled"` under non-passthrough modes, it remapped the budget into adaptive thinking and effort levels.

#### Current Local DurinDoor Implementation
DurinDoor does not contain `open-sse/services/thinkingBudget.ts` or a global proxy-wide thinking mode switch:
- DurinDoor manages thinking budgets per-request and per-provider rather than via global server-wide overrides:
  - Provider registry defaults: `open-sse/executors/default.js:360-368` applies `requestDefaults.thinkingBudgetTokens` and `requestDefaults.thinkingType` (e.g. for `glmt`).
  - Minimum budget floors: `ensureThinkingBudget` in `open-sse/executors/default.js:525-546` bumps `max_tokens` for reasoning models on ClinePass (`THINKING_BUDGET_FLOOR = 4096`).
  - Unified protocol translation: `open-sse/translator/concerns/thinkingUnified.js` handles cross-provider conversions (e.g. mapping OpenAI `reasoning_effort` to Gemini `thinkingConfig` or Claude `thinking`).
  - Model capabilities: `open-sse/providers/capabilities.js` and `src/lib/modelCapabilities.js` track model-level reasoning boundaries (`thinkingCanDisable`, `maxOutput`).
- In DurinDoor, caller-specified budgets and provider defaults take precedence. There is no `settings.thinkingBudget` table or proxy-wide boot hydrator in `src/shared/services/initializeApp.js`.

#### Disposition
- **OmniRoute #5352 (Hydration and BaseExecutor thinking mode)**: **Not applicable / Architectural divergence**. DurinDoor intentionally keeps caller-driven defaults, model capability guards, and provider registry configurations rather than imposing proxy-wide database overrides. No gap exists in DurinDoor for global budget hydration because the underlying proxy-level toggle service is absent by design.

---

### 3. Native Reasoning History and Redacted Thinking Replay (#5352 Part B)

#### Upstream Mechanism
When replaying conversation history from an OpenAI-compatible client (such as Cursor or Cline) to an Anthropic Messages endpoint:
- Assistant turns often contain `reasoning_content`.
- Prior to #5352, upstream translated `reasoning_content` into `{ type: "thinking", thinking: msg.reasoning_content, signature: DEFAULT_THINKING_CLAUDE_SIGNATURE }`.
- Anthropic rejects readable thinking blocks that lack a genuine cryptographic signature generated by Claude (`400 "Invalid signature in thinking block"`).
- In #5352, upstream changed `open-sse/translator/request/openai-to-claude.ts` to emit a signature-less placeholder `{ type: "redacted_thinking", data: DEFAULT_THINKING_CLAUDE_SIGNATURE }`.
- Anthropic accepts `redacted_thinking` blocks without signature validation during replay, while downstream caching preserves reasoning context for non-Anthropic providers.

#### Current Local DurinDoor Implementation
In DurinDoor:
- In `open-sse/translator/request/openai-to-claude.js:405-408`:
  ```js
  if (isString(msg.reasoning_content) && msg.reasoning_content && !hasThinkingBlock) {
    blocks.push({ type: CLAUDE_BLOCK.THINKING, thinking: msg.reasoning_content });
  }
  ```
  DurinDoor emits a `thinking` block without any signature property.
- When this translated request passes through `prepareClaudeRequest` in `open-sse/translator/formats/claude.js:1000-1014`:
  - For `provider === "claude"`: `isValidClaudeSignature(block.signature)` is checked. Since `block.signature` is `undefined`, it evaluates to `false`. DurinDoor strips the unsigned thinking block from the assistant message!
  - If the assistant message only contained `reasoning_content` and `tool_calls`, stripping thinking leaves a tool-use turn without preceding reasoning. For adaptive models, no placeholder is inserted, potentially violating Anthropic tool-turn ordering constraints.
- Simultaneously, `open-sse/translator/formats/claude.js:770, 987` explicitly preserves `redacted_thinking` blocks verbatim without signature validation for both `claude` and `anthropic-compatible-*` providers:
  ```js
  if (block.type === CLAUDE_BLOCK.REDACTED_THINKING && (isClaudeNative || provider?.startsWith("anthropic-compatible"))) {
    hasKeptThinking = true;
    kept.push(block);
    continue;
  }
  ```

#### Disposition and Demonstrated Gap
- **OmniRoute #5352 (Redacted Thinking Replay)**: **Demonstrated narrow gap**. When replaying OpenAI assistant turns containing `reasoning_content` to official Anthropic endpoints, converting to an unsigned `thinking` block causes `prepareClaudeRequest` to drop the block. Emitting `redacted_thinking` placeholder blocks allows the reasoning block to survive normalization without failing Anthropic signature validation.

#### Ordinary Offline Acceptance
Add an offline test in `tests/translator/openai-to-claude-reasoning-replay.test.js`:
1. Build an OpenAI message history with an assistant turn carrying `content: "Calling tool"`, `tool_calls: [...]`, and `reasoning_content: "Need to fetch weather"`.
2. Translate the request using `translateRequest("openai", "claude", body)`.
3. Assert that the translated assistant message contains a `redacted_thinking` block preserving the position before `tool_use`.
4. Run the resulting body through `prepareClaudeRequest(result, "claude")` and verify that the `redacted_thinking` block is retained and not dropped.

---

### 4. Source-Only Opt-Out Header (#5367)

#### Upstream Mechanism
OmniRoute #4633 previously decided to inject a literal string `</think>` into visible `content` chunks when a Claude thinking block finished during `claude-to-openai` streaming translation. This caused severe issues in clients that natively handle `reasoning_content` (such as Cursor), where an orphan `</think>` tag was rendered directly in the user's chat UI.
- Upstream introduced User-Agent matching (#5348) to suppress the tag for known clients (like OpenCode).
- In **OmniRoute #5367**, upstream added an explicit client request header `x-omniroute-thinking-marker: off` (or `on`/`keep`/`suppress`), resolved via `resolveSuppressThinkClose` in `open-sse/utils/thinkCloseMarker.ts` and extracted in `open-sse/handlers/chatCore.ts`. This allowed clients to opt out of the synthetic `</think>` text injection.

#### Current Local DurinDoor Implementation
DurinDoor has a completely different, clean architectural design for reasoning streams:
- In `open-sse/translator/response/claude-to-openai.js:78-82`:
  ```js
  // Track the thinking block internally only. Thinking text flows through
  // reasoning_content (see thinking_delta below) — never inject literal
  // <think>/</think> markers into content. They leak as visible text to any
  // external OpenAI consumer and displace the thinking block from first
  // position when a downstream proxy rebuilds a Claude message.
  ```
- In `open-sse/translator/response/claude-to-openai.js:136-140`:
  ```js
  // End of thinking is signaled by state, not by a literal </think> text
  // chunk. Consumers that need an explicit "reasoning ended" event (#454)
  // detect the reasoning_content → content transition instead.
  ```
- DurinDoor **never** injects literal `<think>` or `</think>` markers into visible `content` during `claude-to-openai` response streaming.
- Consequently, client-visible orphan `</think>` leaks do not occur in DurinDoor.

#### Disposition
- **OmniRoute #5367**: **Source-only opt-out header; Not applicable / Rejected by design**. The `x-omniroute-thinking-marker` header is an inbound workaround created solely to patch upstream's earlier decision to leak synthetic text markers into `content`. Because DurinDoor strictly segregates reasoning into `reasoning_content` and never injects marker strings into visible `content`, client opt-out headers are unnecessary and would introduce redundant protocol baggage.

---

## PR Dispositions Summary

| PR | Reviewed Head / Enclosing Merge | Upstream Purpose | DurinDoor Disposition | Notes / Acceptance Scope |
|---|---|---|---|---|
| **#4823** | `da73e318b7ad977652020f9d738fc7310cf6f6fc` / `885134b192a273471a52a02ee36397eef8d788aa` | Case-insensitive default guard for `anthropic-version` | **Superseded by #4846 / Narrow gap** | Superseded by #4846's generalized header normalization. |
| **#4846** | `17d6b23bde226cccc37b23e09d00f6e5b2e12f55` / `f52863c80a81bbfe3eb1923f384573313e2ca20f` | Deduplicate and lowercase case-variant `anthropic-version` and `anthropic-beta` headers | **Demonstrated narrow gap** | Missing normalization pass allows undici to comma-merge duplicate case-variant headers. Acceptance: assert single lowercase canonical header with deduped values. |
| **#5352** | `085bb494ed692f98ca368525051bcc9c32e41620` / `7592ef16e0fddb63a533611a58e4a8ea1b89b1c0` | Thinking budget hydration, BaseExecutor mode enforcement, and `redacted_thinking` replay | **Dual disposition: Not applicable (budget hydration) / Demonstrated narrow gap (redacted replay)** | Global budget hydration is an unported upstream architecture; DurinDoor uses provider and capability defaults. Replay gap: emit `redacted_thinking` placeholder so reasoning context survives `prepareClaudeRequest` without 400 signature failures. |
| **#5367** | `0e5287219908cbb9c3f67dd2a64a79f991893e35` / `734061f736f62bc95d028fb0d8878e7d023c97be` | Inbound `x-omniroute-thinking-marker` header to opt out of `</think>` in content | **Source-only opt-out header; Not applicable / Rejected by design** | DurinDoor never injects literal `</think>` tags into visible stream `content`, rendering client-side suppression headers unnecessary. |

Refs #1073
