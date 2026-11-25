# 1073: Responses developer instructions on Gemini translation

Checked 2026-11-20 against [OmniRoute #18704](https://github.com/cheaper-inference/OmniRoute/pull/18704), merged, head `69de44be99635144086c07e5b68964ad313bd059`, "fix(translator): preserve Responses developer instructions for Gemini".

## Disposition: **Ported, adapted to local code**

Current local behavior did **not** already cover the contract. A registered offline probe of `translateRequest("openai-responses", <gemini target>, ...)` showed that a Responses `input` message with `role: "developer"` survives the Responses→OpenAI pivot unchanged (`openai-responses.js` pushes `{ role: item.role, content }`), and the OpenAI→Gemini converter in `open-sse/translator/request/openai-to-gemini.js` handles only `system`, `user`, `assistant` and `tool`. The developer text was therefore silently absent from `systemInstruction` and from `contents` for `gemini`, `gemini-cli`, `antigravity` and `vertex`. The OpenAI target was unaffected because `filterToOpenAIFormat` already rewrites `developer` to `system`.

## Upstream diff and local adaptation

The upstream change adds one guarded `normalizeRoles` pass after the Responses→OpenAI pivot, for Gemini and Antigravity targets only. DurinDoor has no `normalizeRoles` or `preserveDeveloperRole` option, so the local change is the smallest equivalent in `open-sse/translator/index.js`:

- `isGeminiFamilyTarget` covers `gemini`, `gemini-cli`, `antigravity` and `vertex`, the targets that share `openai-to-gemini.js`.
- After the `openai-responses:openai` pivot, and only when the source is Responses and the target is in that set, each message with role `developer` is copied with role `system`. Messages are new objects, so the caller's `input` is never mutated.
- The existing converter then places `system` text, in message order, into the normal `systemInstruction.parts` field (top-level `instructions` first). Non-text user parts (`inlineData`), assistant history and the function call/response exchange are untouched.

Scope notes:

- Nothing is injected twice: each instruction string appears once, in `systemInstruction`, and never in `contents`. The Antigravity default system prompt is not added by the translator, so it is not duplicated here.
- Typed Responses input (message items with `input_text` arrays), string input with `instructions`, and top-level `instructions` keep their prior behavior.
- Responses→OpenAI, Responses→Claude, native Responses passthrough and Chat Completions→Gemini are not touched by the new branch. The tests assert their existing output.

## Adjacent finding, not changed

Chat Completions messages with `role: "developer"` sent to Gemini targets are also skipped by `openai-to-gemini.js` in this tree. The upstream test pins Chat Completions developer preservation because upstream normalizes roles earlier for Chat; DurinDoor does not. That path is outside this port's Responses ingress scope, so it is left as is and documented here rather than widened silently. A separate change can promote `developer` inside the Gemini converter if wanted.

## Evidence

Offline only: no provider calls, credentials, browser, Docker or e2e.

- New `tests/unit/omni-responses-gemini-developer-instructions.test.js`: 19 tests, importing `translator/registerAll.js`. For each of four Gemini-family targets it covers interleaved developer/system order and single occurrence, non-text parts plus history and tool exchange, string input with instructions, and a developer item with no top-level instructions. It also covers Chat system carriers for Gemini, OpenAI and Claude outputs, native Responses passthrough and input immutability.
- Before the `index.js` change: 12 of 19 fail (all four targets, instruction-order, history and developer-only cases). After: 19 pass.
- Adjacent offline suites (translator/Gemini/Antigravity/Responses): 8 files, 51 tests pass.
- Wider offline sweep of the 334 test files that mention gemini, antigravity, vertex or developer, run with a private `DATA_DIR`: 328 files pass, 2 are skipped, and 4 DB files fail (`db-migration-chain`, `db-quota-backup-roundtrip`, `db-quota-migration`, `quota-snapshot-concurrency`; 29 tests). The same 29 tests fail with this change reverted, so they are sandbox storage failures unrelated to translation.
- The gate's `vitest related` sweep selects about 1,000 test files for any `translator/index.js` edit, because every translator is statically imported there. A first gate run was killed by the kernel during a host-wide memory episode, with no assertion failure logged; it is not a test result for this change.

Command: `cd tests && node node_modules/vitest/vitest.mjs run --maxWorkers=2 unit/omni-responses-gemini-developer-instructions.test.js`. Dependencies came from private frozen installs (`pnpm install --frozen-lockfile --ignore-scripts` at root and in `tests/`; gitignored `node_modules`).

Limitation: this proves request-body translation only. It does not show that a real Gemini account honors the resulting `systemInstruction`.
