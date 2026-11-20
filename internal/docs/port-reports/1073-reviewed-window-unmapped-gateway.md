# #1073 — reviewed unmapped gateway rows

Reviewed 2026-11-20 against DurinDoor `2237ae77171cbf7e0652e34d7da0e9ae2915ba89`. This is a static defensive comparison of **4 distinct rows**, selected from the 63 path-unmapped rows in [the historical inventory](1073-historical-path-coverage.md). The upstream patches and merge IDs were read from that inventory's retained GitHub API scratch data; local request dispatch and the relevant offline fixtures were inspected at this head. A different filename alone was not treated as evidence of a gap. No provider or live service was called.

## Provider request contracts

### [#15299](https://github.com/cheaper-inference/OmniRoute/pull/15299) — verified gap: MiMo effort normalization

Merge `07c66b86ee20a67625254179a8237e59305740f5`. Upstream `open-sse/executors/base/reasoningEffort.ts` scopes MiMo V2.5/V2.6 on the OpenCode provider family, mapping flat `xhigh`, `max`, and `ultra` to `high`, and `minimal` to `low`; other values and families pass through. The source patch describes an upstream validation contract; this review did not independently test that external contract.

Locally `open-sse/providers/registry/opencode-go.js` lists V2.5 models and `open-sse/providers/registry/opencode-zen.js` lists V2.5/V2.6 models. `open-sse/handlers/chatCore.js` calls `stripBooleanReasoning` in `open-sse/services/opencodeReasoningSanitizer.js`, which only removes boolean `reasoning`; `open-sse/executors/opencode.js` and `open-sse/executors/opencode-go.js` contain no MiMo effort clamp. The latter converts flat effort to a nested field only for Responses models. `open-sse/executors/base.js` has an error-text-driven `high` retry, not this pre-dispatch family rule. Thus the specific normalization is absent on the existing Chat path.

Acceptance for a future change: normalize those four values for V2.5/V2.6 identifiers on the applicable local OpenCode gateway providers before dispatch, preserving accepted values and both flat and applicable nested effort representations; leave other models and providers unchanged. Check the exact local alias and request-format paths rather than introducing a provider-wide clamp. Extend nearby offline fixtures `tests/unit/opencode-reasoning-sanitizer.test.js` and `tests/unit/opencode-thinking-effort.test.js` with model/provider boundary and pass-through cases. No implementation is proposed in this report.

### [#15543](https://github.com/cheaper-inference/OmniRoute/pull/15543) — structurally absent endpoint contract

Merge `74eb2135664a74efacc2531d916a92c476bec005`. Upstream `open-sse/config/providers/registry/command-code/index.ts` tags Claude models for Claude format; `open-sse/executors/commandCode.ts` selects `/provider/v1/messages` and an Anthropic version header for those models. The local `open-sse/providers/registry/command-code.js` configures `/alpha/generate`, and `open-sse/executors/commandcode.js` uses that contract and translates AI SDK events. The upstream endpoint-selection defect does not apply to this different local transport; this is not a claim that a Messages endpoint is supported locally.

### [#15566](https://github.com/cheaper-inference/OmniRoute/pull/15566) — present under a different model contract

Merge `e773d967b1b53c348e3a553bdfaac392eff6ee3d`. Upstream `open-sse/handlers/chatCore/claudeEffortVariant.ts` and `open-sse/utils/antigravityLiteralModelIds.ts` prevent tier suffixes on Antigravity Claude 5.x IDs from being stripped as client effort variants; `open-sse/utils/claudeEffortVariants.ts` also suppresses synthesized variants for bare family IDs. Locally `open-sse/translator/concerns/thinkingSuffix.js` parses parenthesized request controls rather than stripping hyphenated tiers. `open-sse/handlers/chatCore.js` resolves the provider-facing ID through `getModelUpstreamId`, and `open-sse/providers/registry/antigravity.js` explicitly maps tiered Claude 5.5 IDs to tiered upstream IDs with parenthesized thinking controls. This addresses the dispatch failure through a different contract; it does not establish parity for upstream's separate catalog-variant generation rule.

## Provider envelope

### [#15631](https://github.com/cheaper-inference/OmniRoute/pull/15631) — present

Merge `b41c7c75bc25f6defe5d331ba26ffab742bbd9ef`. Upstream `open-sse/executors/antigravity.ts` excludes the top-level `stream` field from the Google request envelope. Local `open-sse/executors/antigravity.js` retains `stream` as a non-enumerable in-process property so JSON serialization omits it. `tests/unit/antigravity-strip-stream-field-15631.test.js` checks both properties offline. The implementation differs but addresses the serialized envelope behavior.

## Limits

The count is exactly four, not an estimate of the whole inventory. **59 of the 63 path-unmapped rows remain outside this comparison**, including excluded #15231 and #15337 and any excluded catalog-filter or quota-tracker rows in that population. #15686 is excluded and was classified uncertain, not unmapped, in the historical inventory. No conclusion is drawn about those rows, the 100 uncertain rows, or later upstream changes. The historical report incorrectly attributes `87a753439` to #15231; its retained metadata identifies #15231 as `fca2f868...`, while `87a753439...` belongs to #12917. This report uses the retained per-row merge IDs above and makes no new claim about either excluded row. Static inspection does not establish live provider behavior or test execution.

Refs #1073
