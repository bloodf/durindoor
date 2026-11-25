# #1073 Keep synthetic Gemini schema fields out of client tool calls

Compared 2026-11-20 against OmniRoute [#18269](https://github.com/cheaper-inference/OmniRoute/pull/18269) ("fix(sse): drop the synthetic reason argument from Gemini/Antigravity tool calls"), state `MERGED`.

## Source pins

| Item | Value |
| --- | --- |
| Upstream PR | OmniRoute #18269 |
| Head | `c955fe2581fba140ac0bd4b60f4bbb014d26c1e3` |
| Merge | `cfb61890d4f4fab460c855a1117b4bc5b79b57ce` |
| Local base | integration branch at `859c0eaf1` (worker branch `orq/tornf6/port-omni-gemini-synthetic-reason-a1`) |
| Upstream files read | `open-sse/translator/helpers/geminiPlaceholderArgs.ts` (new), `geminiHelper.ts`, `geminiToolsSanitizer.ts`, `response/gemini-to-claude.ts`, `response/gemini-to-openai.ts`, `handlers/responseTranslator.ts`, `tests/unit/gemini-placeholder-reason-arg.test.ts` |

No provider traffic, credentials, paid API, browser, e2e, Docker or whole-suite run was used. Evidence is source reading, local code and offline fixtures.

## Problem

`cleanJSONSchemaForAntigravity` (`open-sse/translator/formats/gemini.js`) gives every object schema that would otherwise have no properties a required `reason` string property, because Gemini rejects an empty OBJECT. The model fills it, and the translated tool call reaches a strict client with an argument the client never declared (for example Claude Code's parameter-less tools failing with "unexpected parameter 'reason'").

## Dispositions

| Upstream behavior | Disposition | Local owner |
| --- | --- | --- |
| Keep the placeholder on the request | **Kept as is.** The request schema is unchanged; `tests/unit/gemini-empty-schemas.test.js` and `tests/unit/gemini-schema-walkers-name-map-2884.test.js` still pass. This reconciles the earlier "not ported" note in `1072-claude-context-markers.md`: that note concerned removing the placeholder from the request, which is still not done. | `formats/gemini.js` |
| Shared constants for key and description | **Ported** (`GEMINI_PLACEHOLDER_KEY`, `GEMINI_PLACEHOLDER_DESCRIPTION`). | `formats/gemini.js` |
| Rebuild the sent schema from the client tool with the same root coercion and cleaner | **Ported, shared.** `buildGeminiToolParameters` now serves both request call sites in `openai-to-gemini.js` and the response resolver, so there is one transformation. | `formats/gemini.js`, `request/openai-to-gemini.js` |
| Strip `reason` by *shape* (a `{reason: string}` object with the placeholder description) | **Replaced with a stricter rule.** Upstream removes the key at any object whose sent schema merely looks like the placeholder, so a client that declares exactly that schema loses a real argument. Here the cleaner reports the paths where it inserted the placeholder (`placeholderPaths` option), so only inserted positions qualify. | `formats/gemini.js`, `concerns/geminiPlaceholderArgs.js` |
| Resolve tool by client `tools[]` (exact then case-insensitive name) | **Adapted.** Resolution goes provider name, then the response alias map (`toolNameMap`, already composed with Responses and executor aliases), then the client tool. Duplicate client names are unresolved. | `concerns/geminiPlaceholderArgs.js` |
| (not upstream) Confirm against the declaration actually sent | **Added.** A position is stripped only if the provider body that was sent (`tools` or a Cloud Code `request.tools` envelope) still carries the placeholder there. A provider path that does not clean (direct `claude -> gemini`), a depth-compressed schema, or an unmatched declaration leaves the arguments intact. | `concerns/geminiPlaceholderArgs.js` |
| Wire the three Gemini response conversions | **Ported to every local conversion**: streaming `gemini -> openai` (pivot for OpenAI, Responses, Claude and Gemini clients), streaming direct `gemini -> claude`, non-streaming Gemini body (`translateNonStreamingResponse`), and forced SSE-to-JSON (`parseGeminiSSEToOpenAIResponse`). The stream state now carries `clientTools` and `providerBody`. | `response/gemini-to-openai.js`, `response/gemini-to-claude.js`, `handlers/chatCore/nonStreamingHandler.js`, `handlers/chatCore/sseToJsonHandler.js`, `utils/stream.js` |
| Upstream "Not covered": buffered SSE rebuilds (`sseParser/geminiResponse.ts`, `sseCollect.ts`) | **Local equivalent covered.** The local forced-SSE path runs `geminiToOpenAIResponse`, so it strips as well. No separate local collector exists. | `handlers/chatCore/sseToJsonHandler.js` |
| `toGeminiParametersSchema` export | Not applicable. Local root coercion is `normalizeGeminiParameterRoot`, already exported. | n/a |
| Changelog fragment `changelog.d/fixes/...` | Not applicable. This repo has no `changelog.d`. | n/a |

## Supported client tool dialects

The resolver rebuilds the pre-Gemini schema the way each request path does, then runs the shared builder.

| Client | Pre-Gemini transformation reproduced |
| --- | --- |
| OpenAI Chat `{type:"function", function:{name, parameters}}` | `parameters` as sent |
| Claude `{name, input_schema}` (typeless or `custom`) | `normalizeToolSchema` (claude-to-openai); empty or missing becomes an empty object schema |
| OpenAI Responses flat `{type:"function", name, parameters}` | `sanitizeToolSchemaParameters` then `normalizeToolParameters` (the latter moved to `concerns/toolSchema.js` so both paths share it) |
| Native Gemini `functionDeclarations` | `parameters` or `parametersJsonSchema` as sent |

Unresolved and therefore untouched: Responses `namespace` and `custom` tools, typed Claude server tools, tools missing a name, duplicate names, and any call whose provider declaration is missing from the body that was sent.

## Behavior contract

1. The request still sends the placeholder for empty object schemas; populated schemas are untouched.
2. A call argument `reason` is removed only at an object position where the cleaner inserted the placeholder for that exact client tool **and** the sent declaration still carries it there. Arrays are walked per item; nested free-form objects are handled; `additionalProperties` objects count as empty objects.
3. A `reason` the client declared stays, including a declaration whose schema is byte-identical to the placeholder.
4. An object with real declared properties keeps an extra `reason` the model added.
5. Unresolvable tool, missing client tools or provider body, duplicate names, or a sent schema without the placeholder: arguments are returned unchanged (same object).
6. Inputs are never mutated; a changed argument tree is a copy and an unchanged one is returned by identity.
7. Native same-format passthrough is not routed through these paths. Thought signatures (`thoughtSignature`, transport ids, the signature store) and tool names are not read or changed.
8. The direct `claude -> gemini` request path never calls the cleaner, so no placeholder is sent and a model-produced `reason` is left alone there.

## Rejected alternatives

- Stripping by shape alone (upstream): drops a declared `reason` whose schema equals the placeholder.
- Re-deriving the sent schema from the client tool only: cannot tell whether a given provider path cleaned it (direct Claude path) or whether the Antigravity executor flattened it past `MAX_SCHEMA_DEPTH`.
- Removing the placeholder from the request: Gemini rejects an empty OBJECT and Claude on Antigravity needs a required property; unchanged upstream and here.

## Tests

`tests/unit/omni-gemini-synthetic-reason.test.js` (21 cases, offline, real request translators build the sent body):

- request side keeps the placeholder, including nested free-form objects and array items;
- OpenAI-shaped stream for Chat (`gemini`, `gemini-cli`, `antigravity`, `vertex`), Responses and native Gemini clients;
- Claude client through the pivot (`antigravity`, `gemini-cli`) via `translateResponse`;
- direct `gemini -> claude` stream, both the real request path (no placeholder, arguments kept) and a cleaned provider body (stripped);
- alias map restoration for a sanitized tool name;
- thought signatures kept (direct store key and pivot transport id);
- non-streaming body and forced-SSE aggregation;
- unaffected tool (`Bash`), declared `reason`, lookalike declared `reason`, unknown tool, missing inputs, duplicate names, no-placeholder sent body, mutation and identity.

Mutating the `gemini-to-openai` wiring out makes 11 of them fail. The 147 existing test files that import the touched modules (1 454 tests) still pass.

## Verification limits

Offline only. Whether Gemini or Antigravity accepts the request schema, and what a live model returns for a parameter-less tool, were not exercised: that needs a provider account and is out of scope here.
