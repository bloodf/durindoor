# #1073 Kiro: preserve declared tool schemas on `currentMessage`

- Inventory: https://github.com/bloodf/durindoor/issues/1073
- Source: https://github.com/cheaper-inference/OmniRoute/pull/2149, head `29d1d733bd8610d27455d81790a9524a0f81867e`, merge `1814d2bde04842945a1d59b15ccef953bf11cf52` (merged 2026-05-11T13:06:06Z).
- Upstream changed paths: `open-sse/translator/request/openai-to-kiro.ts`, `tests/unit/translator-openai-to-kiro.test.ts`.
- Prior comparison: `internal/docs/port-reports/1073-may-protocol-shapes.md`, gap **K-2**.
- Merged with the integration tip `cd63757f5cc7666b1f235b8f5a056846571c76ef`, which carries the gap **K-1** unit (`9cb5f5df88`, `internal/docs/port-reports/1073-kiro-final-turn-history.md`). See "Interaction with the K-1 unit" below.

## Disposition

**Ported, in the local mechanism.** The caller-declared tool schema now always reaches
`currentMessage.userInputMessage.userInputMessageContext.tools` on the Kiro request routes, for
both the OpenAI-shaped and the Claude-shaped transcript. The schema is carried over from the turn
that received it, and is taken from the request's own `tools` array when no user turn received it.

Upstream part (a), synthesizing a schema from tool names found in the history, is **not** ported:
the local no-fabrication policy stands, and the local flatten-to-text path for clients that declare
no tools is unchanged. Upstream parts (b) and (c) are the ones this change covers.

## The residual, confirmed on the pre-change tree

Kiro's CodeWhisperer validator rejects a request whose history references a tool use while
`currentMessage` carries no tools schema: "Improperly formed request" (HTTP 400). The rule is
recorded in the translator itself at `open-sse/translator/request/openai-to-kiro.js:42-49`.

The local translator attaches the schema to the first **emitted user turn**
(`open-sse/translator/request/openai-to-kiro.js:308-315`, guarded by `toolsInjectedToFirstUserMsg`),
which is not the same turn that becomes `currentMessage`. Before this change the schema was read back
from `history[0]` alone (`open-sse/translator/request/openai-to-kiro.js:446` before the change, the
`firstHistoryTools` read) and re-injected into `currentMessage` after the history cleanup stripped it
from every history turn. Two shapes dropped the schema entirely:

1. **The first element of history is not a user message.** The schema lands on the first emitted user
   turn, which is not `history[0]`, so the `history[0]`-only read missed it. When the last user turn
   became `currentMessage` and the schema-carrying turn stayed in the history, `currentMessage` was
   left with no schema while the history still referenced the tool use.
2. **The history has no user turn.** No turn ever received the schema, so it was attached to nothing
   and `currentMessage` was left with no schema while the history still referenced the tool use.

The same `history[0]`-only read was present on the sibling Claude route
(`open-sse/translator/request/claude-to-kiro.js:307-308` before the change), which the May comparison
recorded as adjacent surface outside that batch. It is the same defect on the same provider and is
covered here.

Both shapes were confirmed offline before the change: the four new fixtures in
`tests/unit/omni-kiro-declared-tool-schema-current-message.test.js` fail against the pre-change
translator (`AssertionError: Target cannot be null or undefined`, from the absent
`userInputMessageContext`) and pass after it. The two guard fixtures that assert no schema is
invented for a tool-less client pass in both states.

## Interaction with the K-1 unit

The K-1 unit (`9cb5f5df88`) changed the same file: the current turn is now selected by the
transcript's own last turn (`open-sse/translator/request/openai-to-kiro.js:472-488`) instead of by
promoting the last `userInputMessage` found anywhere, and a transcript that ends with an assistant or
tool turn gets a neutral `"Continue"` continuation instead of an older user turn. The two units are
complementary, and the merge keeps both:

- K-1 fixed the trailing-assistant shape by keeping every turn in history, in order. The schema that
  the first emitted user turn received is still found by the carrier scan in that shape, because the
  scan no longer assumes the carrier is `history[0]`.
- K-2 fixes the two shapes K-1 left open, which the K-1 report names as out of its scope
  (`internal/docs/port-reports/1073-kiro-final-turn-history.md`, "Not in scope"): a transcript that
  opens with an assistant turn, and a transcript with no user turn at all. In the second shape the
  current turn is the K-1 `"Continue"` continuation, and it now carries the caller's declared schema
  through the fallback.
- The K-1 rule "a real final user turn still becomes `currentMessage`" is unchanged: when the popped
  turn is the one that received the schema, it keeps it, and the injection is skipped.

The residual was re-confirmed on the integration side of the merge: with the K-1 translator in place
and this port's change removed, the two OpenAI-route fixtures ("a transcript that opens with an
assistant turn" and "a declared tool call with no prior user turn") still fail, and they pass with the
merged result.

## The change

`open-sse/translator/request/openai-to-kiro.js`

- `buildKiroToolSpecs()` (`:202`) is now the single place where a declared tool becomes a Kiro
  `toolSpecification`. The existing per-tool mapping was lifted out of the first-user-turn injection
  unchanged: sanitized name with the original name remembered for the response translator, string
  description, and the schema run through the shared `normalizeKiroToolSchema`. The lifted helper is
  reused by the first-user-turn injection (`:308-315`) and by the `currentMessage` fallback, so both
  paths produce the same specification for the same declaration.
- The schema is now read from **whichever** history turn received it, captured before the cleanup
  strips it (`:496-499`), instead of from `history[0]` alone.
- The injection into `currentMessage` (`:579-591`) takes the carried schema when there is one, and
  otherwise builds it from the request's own `tools` array through the same helper.

`open-sse/translator/request/claude-to-kiro.js`

- The same two changes: the carrier scan (`:312-315`) and the fallback to the caller's own tools
  through the route's existing `buildToolSpecs()` (`:378-391`).

### Boundaries kept

- **No invented tool specifications.** Only caller-declared tools ever become tool specifications.
  Upstream's synthesis of a stub schema from tool names found in the history is not ported.
- **No broadened schema validation.** `normalizeKiroToolSchema` and every other schema rule are
  untouched; the carried schema is the one the client declared, in the shape the local normalizer
  already produced for the first user turn.
- **No credential or sign-in flow touched.** No provider registry entry, model catalog row, executor,
  OAuth service, or API-key path was read or changed. The change is confined to request shaping for
  the already-routed Kiro provider.
- **Local flattening retained.** A client that declares no tools still gets every tool call and tool
  result collapsed into plain text, and no schema is attached to `currentMessage`. The two guard
  fixtures pin this.
- **Unrelated translator formats untouched.** No change outside the two Kiro request translators.

## Offline evidence

- `tests/unit/omni-kiro-declared-tool-schema-current-message.test.js` (new): a leading assistant turn
  followed by a user turn, and a declared tool call with no prior user turn, on both the OpenAI-shaped
  and the Claude-shaped route; plus one fixture per route asserting that a tool-less client gets no
  schema and no surviving structured tool reference.
- Existing Kiro coverage re-run unchanged and green: `tests/unit/openai-to-kiro.test.js`,
  `tests/unit/kiro-outbound-validation.test.js`, `tests/unit/kiro-one-shot-toolcall-repair.test.js`,
  `tests/unit/kiro-tool-name-cache-3107.test.js`, `tests/unit/kiro-toolcall-wrapper.test.js`,
  `tests/translator/bugs-kiro.test.js`, `tests/translator/claude-kiro-direct.test.js`,
  `tests/translator/kiro-tool-index.test.js`,
  `tests/translator/kiro-no-top-level-systemprompt.test.js`.
- On the merged tree: the K-1 fixture `tests/unit/omni-kiro-final-turn-history.test.js` (8 cases) and
  the new K-2 fixture file (6 cases) pass together with `tests/unit/openai-to-kiro.test.js`
  (3 files, 39 tests), and the offline translator surface plus the Kiro unit files pass
  (111 files, 1902 passed, 34 skipped, 0 failed).
- Lint on the two changed translator files: `oxlint` reports no diagnostics.

## Verification limits

The comparison is a static reading of the merged upstream patch at the two pins above and of the
local source, plus offline fixtures. No provider traffic was generated, no credential was read or
used, no paid API was exercised, and no browser, Docker, e2e or whole-suite command was run. The
upstream rejection that motivates the change is the local translator's own documented rule
(`open-sse/translator/request/openai-to-kiro.js:42-49`); it was not re-confirmed against a live Kiro
endpoint in this work. `scripts/check-docs.mjs` fails on this branch for unrelated pre-existing
reports that carry absolute paths from other worktrees; the report introduced here uses only
repository-relative references and adds no new docs-check finding.

Refs #1073
