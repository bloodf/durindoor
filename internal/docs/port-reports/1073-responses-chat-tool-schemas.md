# #1073 Responses → Chat tool schemas

Compared OmniRoute [#18806](https://github.com/cheaper-inference/OmniRoute/pull/18806)
(`fix(translator): sanitize tool schemas on the responses to chat path`), source head
`47a52e1aa81b0382ae89e3a0416a1d4156f77963`, merged as
[`4715073a646ab9ec2b0f211399172a65791923a2`](https://github.com/cheaper-inference/OmniRoute/commit/4715073a646ab9ec2b0f211399172a65791923a2),
against DurinDoor base `2efffba4faa94b7261cec0adabdab500381e1338` on 2026-11-20.

## Source

Upstream sends every `function.parameters` the Responses → Chat translator emits through the
sanitizer its Claude path already uses (`stripInvalidSchemaConstructs`), so a client schema that a
deep-truncating harness mangled (`"enum": "[MaxDepth]"`, an index-keyed object where an array
belongs) cannot reach a strict OpenAI-compatible validator that rejects it before inference. One
pass covers plain function tools, flattened namespace (MCP) sub-tools and tools that already arrive
in Chat shape; valid schemas are unchanged.

## Local disposition

Adapted. The upstream sanitization was already present in this fork as a private
`sanitizeChatSchema` copy inside `open-sse/translator/request/openai-responses.js` (added by
`e7f93398e`, the earlier port of this same upstream PR), applied over the emitted
`tools[].function.parameters` exactly where upstream applies its sanitizer. The upstream
behavior itself was therefore not missing, but the implementation was a second, parallel adapter
next to the shared one, and it did not repair every construct upstream repairs.

## Gap found

1. Two adapters for one job. `open-sse/translator/concerns/toolSchema.js` owns tool-schema
   validation and repair (`normalizeToolSchema`), while the Responses → Chat translator carried
   its own private copy of the construct repair. The two disagreed, and the private copy could not
   be reused by any other request path.
2. Numeric-string constraints were only coerced in the slots the shared normalizer visits
   (`properties`, `items`, `additionalProperties`, `anyOf`/`oneOf`/`allOf`/`prefixItems`,
   `$defs`/`definitions`). A constraint in another schema position — `contains`,
   `propertyNames`, `not`, `if`/`then`/`else`, `unevaluated*`, `additionalItems`, `contentSchema`,
   `patternProperties`, `dependentSchemas` — kept its string form, so `contains: {minimum: "5"}`
   still reached the upstream as a string constraint.
3. A truncated `const` assertion was forwarded verbatim. `const: "[MaxDepth]"` is a placeholder
   the client could not serialize, and forwarding it pins the model's argument to the literal
   placeholder text.

Each gap was confirmed by running the local Responses → Chat path and the pinned upstream
sanitizer over the same fourteen ordinary schema shapes: valid/strict object, truncated enum,
index-keyed enum, numeric string (visited and unvisited slot), boolean subschema, placeholder in a
schema slot, placeholder `const`, string `required`, nested `$defs`, annotation metadata,
`not`/`if`/`then`, and an unknown-key object. The local path matched upstream on every shape except
the three above.

## Change

`open-sse/translator/concerns/toolSchema.js` gains `sanitizeToolSchemaParameters(schema, toolName)`:
the existing shared `normalizeToolSchema` (structural validation, numeric coercion, `required:
true` lifting) followed by a new `repairSchemaConstructs` pass that repairs the invalid constructs
in schema positions only — an array keyword that holds a non-array or an index-keyed object, a
placeholder string where a subschema belongs, and a placeholder `const`.

`open-sse/translator/request/openai-responses.js` drops its private `sanitizeChatSchema` copy and
routes every emitted tool schema through that shared adapter: function tools, namespace (MCP)
sub-tools, custom (freeform) tools and tools that already arrive in Chat shape. The Chat → Responses
direction of the same file keeps calling `normalizeToolSchema` alone.

Semantics preserved:

- **Valid schemas are unchanged.** A schema with an object root, a `required` list, `enum` arrays,
  `additionalProperties: false`, nested objects and annotation metadata (`title`, `description`,
  `default`, `examples`) reaches the Chat upstream as declared. `strict` on the tool declaration
  and its description are untouched.
- **Boolean subschemas stay boolean.** `additionalProperties: false` and a `false` property schema
  are valid JSON Schema permission gates; neither becomes a permissive `{}`.
- **Annotation metadata stays literal.** Only schema positions are visited, so a `default` or
  `examples` payload keeps its value even when it contains an `enum`-shaped key.
- **No validation relaxation.** A structurally malformed `properties` or `required` still fails with
  the existing HTTP 400 (`invalidToolSchemaError`), and the caller's schema object is never
  mutated.
- **Other route formats are unaffected.** The Chat → Responses direction and the Claude and Gemini
  request paths still use `normalizeToolSchema` alone; their schemas are not repaired.

Rejected alternatives:

- Porting upstream's `stripInvalidSchemaConstructs` verbatim. It recurses into every object value
  under any key, which would rewrite literal `default`/`examples` payloads that happen to contain
  an `enum`-shaped key. This fork's existing convention is schema positions only, so the repair
  follows that convention instead.
- Replacing the HTTP 400 on a malformed `properties`/`required` with a silent repair. Upstream's
  sanitizer would drop the keyword; that is a validation relaxation outside this port's scope.
- Applying the repair to the Chat → Responses direction or to the Claude and Gemini paths. Those
  are separate route formats with their own schema contracts; leaving them untouched keeps this
  change to the Responses → Chat hop.
- Expanding namespace sub-tools to upstream's `namespace__subtool` name. This fork keeps the dotted
  `namespace.subtool` name, and the response side restores the namespace through the tool-name
  map, so the upstream naming was not adopted.

## Focused evidence

`tests/unit/omni-responses-chat-tool-schemas.test.js` covers the Responses → Chat hop offline: the
valid schema preserved with its strict intent and metadata, the truncated string enum dropped with
its valid sibling kept, a namespace (MCP) sub-tool sanitized, an index-keyed enum object coerced
to an array, a tool that already arrives in Chat shape repaired, numeric-string constraints
coerced in a schema slot the shared normalizer does not visit, a placeholder replaced and boolean
subschemas kept, a truncated `const` dropped while a real one survives, the caller's schema object
left unmutated, and the Chat → Responses route left on its own schema handling. Synthetic
translator calls only; no provider call, browser, Docker, live request or paid API is involved.

Against the pre-change source the same file fails 2 of 10 assertions — the numeric-string
constraint in `contains` and the truncated `const` — and the other 8 pass, which is the evidence
that the valid-schema assertions describe behavior the change preserves rather than behavior it
introduces.

The offline translator suite passes (92 files, 1820 tests, 0 failures; 9 files and 34 tests
skipped as pre-existing). The 27 focused files that exercise this path — the Responses request
tests, the tool-schema and namespace-tool translator tests, and the format round-trip and
conformance files — pass with 261 tests. ESLint and the anti-slop (oxlint) gate report no
diagnostics for the two changed files.

Verification limits: the upstream Ollama Cloud rejection quoted in the upstream report was not
reproduced here (no provider traffic), and the sanitizer comparison was made against the pinned
upstream source rather than a live upstream. The route-format claims above are code-path and
offline-test evidence, not provider traffic.

Commitlint passes for this change (`npx commitlint --from=HEAD~1 --to=HEAD`, exit 0). The
branch-wide range `origin/main..HEAD` still reports two subjects that this change did not touch —
`beb459909` ("Fix Cowork model selection and Windows CLI packaging (#1129)") and `145f588cc`
("feat: Added McpMarketplaceModal to the CoworkToolCard for improved plugin management.") — both
inherited from the branch's upstream merge history and already failing before this change.
