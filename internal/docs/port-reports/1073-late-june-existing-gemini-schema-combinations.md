# #1073 late-June existing Gemini schema combinations

## Scope and pins

Reviewed only the named runtime changes for the Antigravity outbound envelope (provider-owned native tool mixed with function declarations) and for the Antigravity-to-OpenAI tool-schema handling of `required` and JSON Schema Draft 2020-12 metadata. Both changes were read from their exact public head commits.

| PR | Exact head | Enclosing merge | Patch base | Public patch |
| --- | --- | --- | --- | --- |
| [OmniRoute #4821](https://github.com/cheaper-inference/OmniRoute/pull/4821) | `0e9401d22d37906963c7c4d0658013146197d8f1` | `c4e5d586fc9c8bb4e91669456fceefcf25ea2215` | `7ff7af585b275e61672e595c6081bbe359c6ee89` | [head diff](https://github.com/cheaper-inference/OmniRoute/commit/0e9401d22d37906963c7c4d0658013146197d8f1) |
| [OmniRoute #4843](https://github.com/cheaper-inference/OmniRoute/pull/4843) | `e58fcc231576417f3d54de0a3cafc906829905e6` | `4f8a986905c54c6e16e107bf9863cf5f1d110863` | `f4a9e65342f39f40a84a0cd7094f2b6be31d6e46` | [head diff](https://github.com/cheaper-inference/OmniRoute/commit/e58fcc231576417f3d54de0a3cafc906829905e6) |

For both rows the enclosing merge is a single-parent commit whose parent is the PR head's parent, and the merge tree is identical to the PR head tree: `base..head` and `base..merge` produce the same diff, so neither enclosing merge carries unrelated PR changes and the patches above are the complete public changes. No other upstream commit was treated as part of either patch.

## Current behavior and evidence

### #4821 — strip built-in tool names out of the Antigravity envelope's function declarations

The patch adds a built-in name set (`google_search`, `web_search`, `search_web`, `googleSearch`) to the Cloud Code envelope builder. Function declarations whose name is in that set are removed from `request.tools`, a declarations group that becomes empty is dropped, native grounding entries (`{ googleSearch: {} }`) are left untouched, and `toolConfig.functionCallingConfig.mode = "VALIDATED"` is only forced when custom declarations remain. The upstream trigger is a request whose envelope carries a native grounding entry next to a `functionDeclarations` group, because upstream's Gemini tool builder emits a native `{ googleSearch: {} }` entry for a Google-Search tool while the OpenAI-shaped `google_search` function still lands in the declarations group.

DurinDoor's Gemini/Antigravity request path never produces that combination:

- Every client tool is converted into one `functionDeclarations` group; no native grounding entry is created: [tool conversion](../../../open-sse/translator/request/openai-to-gemini.js), [declaration group](../../../open-sse/translator/request/openai-to-gemini.js). The Claude-shaped Antigravity envelope does the same: [Claude envelope tools](../../../open-sse/translator/request/openai-to-gemini.js).
- The Antigravity envelope copies that group and forces `VALIDATED` only when a tool list exists and no `toolConfig` was set: [envelope builder](../../../open-sse/translator/request/openai-to-gemini.js), [VALIDATED default](../../../open-sse/translator/request/openai-to-gemini.js).
- A Google-Search tool arriving in a Gemini-shaped client body is dropped by the Gemini-to-OpenAI hop before the Antigravity envelope is built, because that hop forwards `functionDeclarations` only: [gemini-to-openai tools](../../../open-sse/translator/request/gemini-to-openai.js).

Offline fixture evidence (synthetic bodies, `translateRequest` and the exported Antigravity request builder, no credentials):

| Fixture | Result |
| --- | --- |
| OpenAI -> Antigravity, tools `google_search` + `read_file` | `request.tools` = one declarations group holding **both** `google_search` and `read_file`; `toolConfig` = `{"functionCallingConfig":{"mode":"VALIDATED"}}` |
| OpenAI -> Antigravity, tool `google_search` only | one declarations group holding `google_search`; `toolConfig` = `{"functionCallingConfig":{"mode":"VALIDATED"}}` |
| OpenAI -> Gemini (standard), tool `google_search` | one declarations group holding `google_search`; no native grounding entry anywhere in the result |
| Gemini source with `[{ googleSearch: {} }, { functionDeclarations: [...] }]` -> Antigravity | the native entry is dropped; only the custom declaration group survives |

A client function literally named `google_search` is a normal client tool here, so the upstream name filter would delete a valid registration rather than a provider-owned built-in. The only place a mixed native-plus-declaration array survives locally is a client-authored Gemini body forwarded unchanged to the Gemini provider (source format equals target format); that array is the client's own and is not rewritten toward the Antigravity `v1internal` endpoint that the upstream 400 concerns. Existing offline fixtures for this path are the Antigravity request/response suite [bugs-antigravity.test.js](../../../tests/translator/bugs-antigravity.test.js) and the Antigravity envelope fixtures in [gemini-no-schema-mutation-1381.test.js](../../../tests/translator/gemini-no-schema-mutation-1381.test.js).

**Disposition: no port.** The upstream trigger cannot occur in DurinDoor because no native grounding entry is ever emitted on the Gemini/Antigravity outbound path, and the name filter would remove a legitimate client tool declaration. Keep the current registration behavior, the `VALIDATED` default, and the existing provider scope unchanged; no test or product change is warranted.

### #4843 — Antigravity-to-OpenAI tool schemas: `required` and Draft 2020-12 metadata

The patch replaces the inline schema normalization in the Antigravity-to-OpenAI request translator with a helper that lowercases `type`, removes the JSON Schema Draft 2020-12 meta keywords (`$schema`, `$defs`, `definitions`, `$ref`, `$comment`, `const`, `additionalProperties`, `propertyNames`, `patternProperties`, `title`, and any `x-*` key) at every level, and reconciles `required` against the surviving `properties` (entries naming an absent property are dropped; `required` is removed entirely when nothing survives).

Two details of the public patch matter for the port decision:

- At the patch base, `required` was already preserved. The base normalizer copies each schema node and only rewrites `type`, deletes `enumDescriptions`, and recurses into `properties`/`items`, so a `required` array survived the shallow copy at every level it reached. The head's real behavior change is the meta-keyword removal plus the `required` reconciliation, not the preservation of `required` itself.
- The head removes `$defs` and `$ref` without resolving pointers first, so a `$ref`-carrying schema loses its target.

DurinDoor's Antigravity-to-OpenAI translator is the same direction and does not carry either of the head's additions: [tool conversion](../../../open-sse/translator/request/antigravity-to-openai.js) calls [normalizeSchemaTypes](../../../open-sse/translator/request/antigravity-to-openai.js), which copies every key except `enumDescriptions`, lowercases `type`, coerces ProtoJSON integer constraints, and adds the compatibility placeholder property for an empty object schema. `required` therefore survives verbatim, and no Draft 2020-12 meta keyword is removed.

Offline fixture evidence (synthetic Antigravity request bodies through `translateRequest`/`antigravityToOpenAIRequest`, no credentials):

| Fixture | Result |
| --- | --- |
| Draft 2020-12 declaration (`$schema`, `additionalProperties`, `title`, `$defs`, `required: ["path","contents"]`) | OpenAI tool parameters keep `$schema`, `additionalProperties`, `title`, and `$defs`; `required` is preserved as `["path","contents"]` |
| Declaration with `required: ["kept","ghost"]` and only `kept` in `properties` | OpenAI tool parameters keep `required: ["kept","ghost"]` — the stale entry is forwarded |
| Nested object with `required: ["kept","ghost"]` | the stale nested entry is forwarded unchanged |
| Claude -> OpenAI with the same Draft 2020-12 keywords | the keywords are forwarded as well, so the OpenAI wire keeps them for other source formats too |

The fork already owns the cleaner that upstream is reaching for, but only on the Gemini/Antigravity outbound side: [unsupported keyword list](../../../open-sse/translator/formats/gemini.js), [pointer resolution before removal](../../../open-sse/translator/formats/gemini.js), [keyword removal](../../../open-sse/translator/formats/gemini.js), and the recursive `required` reconciliation against surviving properties [cleanupRequired](../../../open-sse/translator/formats/gemini.js). That cleaner is applied on the Gemini outbound path — the same Draft 2020-12 fixture translated to Gemini keeps `required: ["path","contents"]` and drops `$schema`, `$defs`, `additionalProperties`, and `title` — but the Antigravity-to-OpenAI path has no equivalent, and the fork's shared OpenAI-wire normalizers keep the same keywords for every source format.

**Disposition: narrow port recommended.** Port only the residual upstream behavior into the Antigravity-to-OpenAI request translator: remove the Draft 2020-12 meta keywords at every level and reconcile `required` against the surviving `properties`, while keeping every valid `required` entry. Scope it to that one translator — do not change the Gemini/Antigravity outbound cleaner, the other OpenAI-wire source formats, or the tool-name and tool-choice handling. Reuse the fork's existing resolution-first order (`resolveJsonSchemaRefs` before removal) rather than copying upstream's raw `$defs`/`$ref` deletion, so a `$ref`-carrying schema keeps its referenced shape instead of being orphaned. The `required` preservation the upstream title describes is already satisfied locally and needs no change.

## Acceptance

The only demonstrated gap is the narrow Antigravity-to-OpenAI schema cleanup above. Its acceptance is an ordinary offline translator test with synthetic bodies, no provider credentials, and no live provider traffic:

1. An Antigravity-format request whose function declaration carries a Draft 2020-12 schema (`$schema`, `$defs`, `$comment`, `$ref`, `const`, `additionalProperties`, `propertyNames`, `patternProperties`, `title`, an `x-*` key) translated to the OpenAI target keeps a valid `required` array, and none of those meta keywords remain at any level.
2. A `required` entry naming a property that is absent from `properties` is dropped, `required` is removed entirely when no entry survives, and the same reconciliation holds for a nested object node.
3. A declaration whose schema uses `$ref`/`$defs` still resolves to the referenced property shape rather than losing it.
4. The Gemini/Antigravity outbound path keeps its current behavior (meta keywords removed, `required` preserved and reconciled) and the existing Antigravity fixtures stay green, so the change does not leak into the Gemini provider scope.

#4821 requires no acceptance work: no behavior changes with that disposition.

Verification limits: every statement above comes from reading the pinned public patches and from offline fixtures over synthetic bodies. No live provider request, credentialed account, browser, Docker, or paid API was used, and no provider account was exercised to confirm that an OpenAI-compatible upstream rejects the meta keywords — that part rests on the upstream patch's rationale.
