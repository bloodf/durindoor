# #1073 May compression and envelope review

Static comparison of the exact OmniRoute PR commits with the checked-out DurinDoor source and ordinary offline fixtures. The review excludes source-only compression engines and configuration changes; it does not propose product-code or test changes.

## Pins and method

- [OmniRoute #1876](https://github.com/cheaper-inference/OmniRoute/pull/1876): PR head and enclosing merge `6e38bd5393950586836af08269edf781bdfa3c34`; patch base `dde74281de2311c7c9878689826885f931be8e12`. Reviewed the head commit patch, not unrelated merge contents.
- [OmniRoute #2028](https://github.com/cheaper-inference/OmniRoute/pull/2028): PR head `7e7e600bd6daf504382cb8b7e140a35751fbdd3b`; patch base `65d63d566e99dd4a793a87ffd5502ec292a6d42a`; enclosing merge `831829dbc345ce5abd900e695a42da779bcb0f7b` (first parent `deb2180c9b88cf0646002809eed76a9fad1aefde`). Reviewed the PR head patch rather than treating the enclosing merge as a PR-specific diff.
- Current evidence is source and existing fixture coverage only; no live providers or external APIs were used.

## #1876 — disposition: no port

The patch has three distinct areas: it ignores saved default combos unless their pipeline has multiple stages; defers compression usage-receipt attachment until the analytics write settles; and changes two OmniRoute compression metadata routes from API-key settings policy to management authentication.

DurinDoor's analogous default path is settings-driven: `enginesFromV2Settings` maps explicit `compressionV2Mode` and `compressionV2Stack` into toggles, `deriveDefaultPlan` maps those toggles into a single-mode plan or a stack, and `runCompressionSeam` executes that plan. The built-in `DEFAULT_COMPRESSION_CONFIG.stackedPipeline` is `rtk` then `caveman`; ordinary fixtures cover stack ordering and step dispatch in [plan-to-engine-ids.test.js](../../../tests/unit/compression/plan-to-engine-ids.test.js) and [compression-chatcore-f1b.test.js](../../../tests/unit/compression-chatcore-f1b.test.js). There is no saved-combo default lookup in this local path, so the upstream seeded single-engine combo override does not map to an existing behavior gap.

The usage-receipt timing patch has no corresponding `attachCompressionUsageReceipt` or compression-analytics write path in the local chat handler. It is not a port candidate for this source surface.

DurinDoor has only `/api/compression/preview` under the compression API tree; the upstream `/language-packs` and `/rules` metadata endpoints do not exist locally. The preview route documents that it runs behind the dashboard proxy's deny-by-default `/api/*` guard and that it must not re-check the LLM API-key setting; see [preview/route.js](../../../src/app/api/compression/preview/route.js). Language-rule metadata and loading are currently local service behavior: the Indonesian pack fixture checks available packs, categories, rule selection, and English fallback isolation in [caveman-indonesian.test.js](../../../tests/unit/compression/caveman-indonesian.test.js). Adding upstream metadata routes or transplanting their auth changes would alter the local app's access surface without a matching route need. Preserve the existing proxy boundary and local metadata access.

No narrow gap was demonstrated, so no additional offline acceptance fixture is warranted.

## #2028 — disposition: skip as source-only engine/config behavior

The PR changes OmniRoute RTK's `shouldCompressMessage`: assistant and tool messages with code fences become eligible only when `applyToCodeBlocks` is enabled. Its added ordinary test verifies that fenced assistant text remains unchanged when that flag is false. This relies on OmniRoute's configurable RTK engine contract, which is excluded from this review.

DurinDoor's RTK helper has no `shouldCompressMessage`/`applyToCodeBlocks` selection contract. Its existing `compressMessages` operates on tool outputs and protects fenced payloads unconditionally via `isProtectedPayload`; the default config also records `applyToCodeBlocks: false`. The Responses fixtures in [rtk-responses-tool-output.test.js](../../../tests/unit/rtk-responses-tool-output.test.js) establish that function and custom-tool output identities stay intact, only eligible `input_text` is rewritten, error outputs and fenced/JSON payloads are left unchanged, and a second pass does not rewrite again. Thus the relevant envelope and omission behavior already has ordinary fixture evidence; adding the upstream switch would introduce an engine/config surface outside scope.

The adjacent language-rule behavior is independent of RTK fence selection and remains covered by [caveman-indonesian.test.js](../../../tests/unit/compression/caveman-indonesian.test.js). No narrow gap was demonstrated, so no extra offline acceptance fixture is warranted.
