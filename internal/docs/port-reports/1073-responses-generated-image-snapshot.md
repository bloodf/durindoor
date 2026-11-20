# #1073: completed Responses image snapshots

Review 8 of [DurinDoor #2097](https://github.com/bloodf/durindoor/pull/2097), a follow-up to [OmniRoute #20610](https://github.com/cheaper-inference/OmniRoute/pull/20610), reproduced a native Responses stream containing only a completed image generation snapshot and no usage. The empty-stream guard replaced that successful terminal with `stream_error` because its snapshot classifier recognized text and tool calls but not image results.

The native terminal classifier now recognizes a completed `image_generation_call` with a usable result in a completed response, using the existing Responses content predicate. It leaves the wire event and usage untouched. Failed, cancelled, incomplete and empty image results do not qualify. The offline fixture covers the regression, ordering, usage, empty results and non-success histories; existing snapshot tests remain intact. This change does not modify the image provider route.

Focused evidence: `test -s internal/docs/port-reports/1073-responses-generated-image-snapshot.md && (cd tests && node node_modules/vitest/vitest.mjs run --maxWorkers=2 unit/omni-responses-generated-image-snapshot.test.js)`.
