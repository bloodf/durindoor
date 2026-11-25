# #1073 Gemini numeric enum contract (OmniRoute #760)

Compared 2026-11-20 against integration base `fa9d400fb0` and merged OmniRoute [#760](https://github.com/cheaper-inference/OmniRoute/pull/760) ("Fix Gemini API error with integer enum in tool parameters"):

- exact head `75d35602473b82d50f7cb988fc26e195442d49cd`
- merge `9fc3845d92ad1de3479415aeb362aa813449ff86` (present in the local object store)

No provider, browser, credential, paid API, Docker, e2e or full-suite run was used. Evidence is source reading, the public Gemini `Schema` definition and focused offline tests.

## Upstream mechanism

#760 changes one function in `open-sse/translator/helpers/geminiHelper.ts`. Before it, `convertEnumValuesToStrings` stringified every enum value and set `type: "string"` only when `type` was missing. After it, a node with `type: "integer"` or `"number"` has its `enum` deleted outright; other nodes keep the stringify behavior. Its stated trigger is the Gemini 400 `enum: only allowed for STRING type` for MCP tools with integer enums.

## Target format definition

The Gemini API `Schema` object (`ai.google.dev/api/caching#Schema`) defines `enum` as "Possible values of the element of Type.STRING with enum format". `minimum` and `maximum` are defined for `Type.INTEGER` and `Type.NUMBER`. So an `enum` list is valid only on a string node, and numeric bounds are valid on numeric nodes.

## Local behavior before this port

`cleanJSONSchemaForAntigravity` (`open-sse/translator/formats/gemini.js`) is the shared Gemini schema cleaner. It is used by `openai-to-gemini.js` (OpenAI and Claude-shaped tools, Gemini CLI, Antigravity) and `executors/antigravity.js`. Its `convertEnumValuesToStrings` is the same pre-#760 workaround: stringify and default the type. For `{type:"integer", enum:[1,2,3], minimum:1, maximum:3}` it emitted `{type:"integer", enum:["1","2","3"], minimum:1, maximum:3}`: still an enum on a non-string node, so the 400 #760 describes was still reachable, and the values had become strings. A typeless `const: 5` or `enum:[1,2]` became a string enum, changing the value type.

The direct Claude to Gemini translator (`open-sse/translator/request/claude-to-gemini.js`, registered `claude:gemini` and chosen by `translateRequest` for Claude-format clients on Gemini-format providers) never calls the cleaner. It forwarded `normalizeGeminiParameterRoot(normalizeToolSchema(input_schema))` unchanged, so a numeric enum reached Gemini as is.

So the gap is real on two enabled tool routes.

## Disposition

**Ported as a contract-equivalent, not as the upstream deletion.** The generic `delete obj.enum` is not transplanted. It would drop the allowed-value information entirely.

For a node whose type is `integer`, `number` or `boolean` (a single non-null type, so `["integer","null"]` counts), the enum list is lifted off the node:

- `type`, `minimum`, `maximum` and every other numeric constraint stay exactly as sent.
- The enum is not stringified. The allowed values go into `description` as `Allowed values: 1, 2, 3.` (appended to an existing description), so the model still sees them.
- A typeless enum or `const` whose values are all numbers or all booleans gets the matching `integer`, `number` or `boolean` type, not `string`.
- String enums, mixed typeless enums and `type: "string"` nodes keep the existing stringify behavior.
- The client's original tool schema is never mutated, and client-side validation of tool arguments is unchanged: the gateway only reshapes the copy sent to Gemini.

Implementation: `liftNonStringEnum` in `open-sse/translator/formats/gemini.js`, called from `convertEnumValuesToStrings` (all cleaner routes) and exported as `liftGeminiNonStringEnums` for the direct Claude route, which applies it to a `structuredClone` of the normalized schema and nothing else. The direct route's other schema handling is deliberately unchanged.

## Not changed

- No new route, schema feature or generic keyword stripping.
- `UNSUPPORTED_SCHEMA_CONSTRAINTS`, `$ref` resolution, `anyOf`/`allOf` flattening and the `reason` placeholder behavior are untouched.
- The cleaner is idempotent: the Gemini CLI path cleans twice, and the second pass finds no enum, so the description hint is not duplicated.

## Evidence

`tests/unit/omni-gemini-numeric-enum-contract.test.js` (10 cases, synthetic offline fixtures): string enums unchanged; integer enum keeps type and `minimum`/`maximum` and loses only the enum, with the description hint; number and boolean types preserved; typeless numeric `const`/`enum` inferred numeric; mixed typeless still stringified; nullable integer enum and array `items`; idempotence; OpenAI to Gemini and Claude to Gemini tool routes; direct Claude route leaves string enums and other fields untouched; caller schemas not mutated.

Regression check: the 137 existing translator and unit files that touch the Gemini or Antigravity schema paths pass (130 passed, 7 skipped).

Refs #1073
