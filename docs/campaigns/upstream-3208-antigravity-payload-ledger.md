# Upstream #3208 — Antigravity Payload, Tool Cap, Schema Resilience

Source PR: <https://github.com/decolua/9router/pull/3208>

This ledger records the port of upstream 9router #3208 into DurinDoor. The
upstream PR carries four loosely coupled changes plus a defensive hardening;
this port covers (a)–(d) explicitly listed in the original scope and adds the
defensive `try/catch` fallback around schema conversion per the steering
direction from the parent agent.

## Scope verification

| Item | Upstream | Status in DurinDoor before this port | Action |
| ---- | -------- | ------------------------------------ | ------ |
| (a) `daily-cloudcode-pa` endpoint migration | New endpoint added in `providers/shared.js` and `registry/antigravity.js` | Already ported in a prior pass — `registry/antigravity.js:72` and `providers/shared.js:78` carry the new URL. Verified identical to upstream. | None (ledger only) |
| (b) Tool-schema compression, 40-tool cap, native Antigravity tools first | `open-sse/executors/antigravity.js` (tool sanitation block) | Not ported. | Implemented verbatim. |
| (c) `SYSTEM_INSTRUCTION_CHAR_LIMIT = 4000`; embed oversized systemInstruction into first user message | Same file, system-instruction block | Not ported. | Implemented verbatim. |
| (d) Resolve `$ref` before `cleanJSONSchemaForAntigravity` strips unsupported keywords | `open-sse/translator/formats/gemini.js` (new Phase 0) | Not ported; `UNSUPPORTED_SCHEMA_CONSTRAINTS` still listed `$ref` / `$defs` for stripping. | Implemented as new private `resolveJsonSchemaRefs` invoked at Phase 0; `$ref` retained on the unsupported list as a defensive fallback. |
| Defensive `try/catch` around `cleanJSONSchemaForAntigravity` | Same hunk as (b) in upstream | Not ported. | Implemented per parent direction — fallback keeps the request alive when the cleaner throws (mitigates fake-429 issue #2877/#2884). |

## Constants (match upstream exactly)

```js
const SYSTEM_INSTRUCTION_CHAR_LIMIT = 4000;
const MAX_SCHEMA_DEPTH = 2;
const MAX_ANTIGRAVITY_TOOL_COUNT = 40;
const MAX_TOOL_DESC_CHARS = 200;
const MAX_SCHEMA_DESC_CHARS = 150;
```

## Files touched

- `open-sse/executors/antigravity.js` — (b) tool sanitation, (c) system-instruction
  truncation/embedding, defensive `try/catch` around the schema cleaner.
- `open-sse/translator/formats/gemini.js` — (d) Phase 0 `$ref` resolver
  (`resolveJsonSchemaRefs`); updated comment on `UNSUPPORTED_SCHEMA_CONSTRAINTS`
  noting that `$ref`/`$defs` are now resolved upstream and only act as a
  fallback.

## Files added (tests)

- `tests/unit/executors/antigravity-payload-limits.test.js` — (b) 40-tool cap
  with native-first retention and (c) oversized-system-instruction embedding.
- `tests/unit/executors/antigravity-schema-fallback.test.js` — defensive
  `try/catch` around the schema cleaner: when the cleaner throws, the executor
  logs a `console.warn` (the `transformRequest` entry point has no `log`
  parameter), downgrades the failing tool to a permissive string/object
  fallback schema, and continues the request instead of propagating the error
  to the client.
- `tests/unit/gemini-resolve-refs.test.js` — (d) `$ref` resolver coverage:
  inlines local `#/$defs/<name>`, supports `#/definitions/<name>` (draft-07),
  replaces unresolvable refs with a safe string placeholder, and survives a
  self-referential circular ref.

## TDD proof

### (b) 40-tool cap + (c) system instruction embed

Initial RED, captured before the production fix landed:

```text
FAIL tests/unit/executors/antigravity-payload-limits.test.js > Antigravity payload limits > caps declarations at 40 while retaining native Antigravity tools
AssertionError: expected [ { name: 'custom_0', …(2) }, …(40) ] to have a length of 40 but got 41
  - Expected: 40
  + Received: 41
    at tests/unit/executors/antigravity-payload-limits.test.js:41:26

FAIL tests/unit/executors/antigravity-payload-limits.test.js > Antigravity payload limits > embeds an oversized system instruction into first user message
AssertionError: expected { Object (parts) } to be undefined
  + Received: { "parts": [ { "text": "ssss...s" } ] }
```

GREEN after the production fix (production code already matched the upstream
hunk in this worktree):

```text
 RUN  v4.1.10 /home/cortexos/Developer/github.com/bloodf/durindoor/.omc/wt-port-3208

 Test Files  1 passed (1)
      Tests  2 passed (2)
   Start at  21:12:59
   Duration  627ms
```

### (d) `$ref` resolution

RED captured after the test was written but before the resolver was added —
the production code at that point ran only `removeUnsupportedKeywords` which
stripped `$ref` and left an empty object for `address`:

```text
 ❯ tests/unit/gemini-resolve-refs.test.js:25:39
    expect(schema.properties.address).toEqual({
        |                                       ^
   "required": [
     "street",
     "city",
   ...
```

GREEN once `resolveJsonSchemaRefs` is invoked at Phase 0:

```text
 RUN  v4.1.10 /home/cortexos/Developer/github.com/bloodf/durindoor/.omc/wt-port-3208

 Test Files  6 passed (6)
      Tests  18 passed (18)
   Duration  2.84s
```

### Defensive `try/catch` around the schema cleaner

RED with the `try/catch` removed — the test forces the mocked cleaner to throw
and the unhandled exception aborts the request:

```text
Error: unsupported cyclic schema
```

GREEN once the `try/catch` is in place — the executor logs a warning, replaces
the broken tool with a permissive fallback schema that still preserves any
valid properties/required, and continues:

```text
 RUN  v4.1.10 /home/cortexos/Developer/github.com/bloodf/durindoor/.omc/wt-port-3208

 Test Files  6 passed (6)
      Tests  18 passed (18)
   Start at  21:28:58
   Duration  2.84s
```

## Coordination notes

- `Port3082Schema` owns the `cleanJSONSchemaForAntigravity` walker changes
  around `cleanupRequired` / `addPlaceholders` (lines ~395–467 in
  `gemini.js`). This port touches only the new `resolveJsonSchemaRefs` helper
  and the Phase 0 invocation site. No overlap.
- The sibling worker on `Port3193Providers` is editing
  `src/app/api/providers/[id]/test/testUtils.js` for unrelated kimchi /
  tokenrouter cases; no shared files in this port.
- Split task check for upstream #2222 (`antigravity-to-openai.js::normalizeSchemaTypes`):
  already fully ported prior to this port. It recurses into `properties`,
  `items`, and `additionalProperties`, and adds a placeholder `properties`
  map to bare `type: "object"` nodes. Covered by
  `tests/unit/antigravity-nested-schema-2222.test.js` (both the
  `cleanJSONSchemaForAntigravity` side and the `normalizeSchemaTypes` side).
  No source change needed; re-ran the suite to confirm green. No overlap
  with this port's files.

## Divergences from upstream

- The executor's `transformRequest` signature does not expose a `log`
  parameter, so the defensive fallback uses `console.warn(...)` with the
  `[9Router]` prefix that upstream also uses. This keeps the operator-visible
  failure path consistent with the rest of the file.
- The fallback schema preserves any well-typed properties the original schema
  declared and only filters `required` entries to those still represented.
  When the cleaner crashes on a schema with no real properties, the fallback
  uses the same `{ reason: string }` shape that the empty-parameters branch
  already uses elsewhere in the file. This matches the spirit of upstream's
  fallback (a safe, Gemini-acceptable object) without inventing new shape.
- `UNSUPPORTED_SCHEMA_CONSTRAINTS` still includes `$ref`, `$defs`, and
  `definitions`. The Phase 0 resolver inlines references for any local schema
  we send, but the strip pass remains as a safety net in case a non-local
  `$ref` survives (e.g. a stray external URI that the resolver leaves alone).
