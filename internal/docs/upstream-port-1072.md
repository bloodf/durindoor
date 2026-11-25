# 9router PR intake #1072

Canonical intake workflow and current pointers: [upstream sync](./upstream-sync.mdx).

Reviewed against upstream snapshot `1855aa44` on 2026-11-20.

| PR | Disposition | DurinDoor evidence |
| --- | --- | --- |
| #5374 | Already in | `open-sse/utils/streamHandler.js` aborts the upstream controller synchronously before calling the disconnect observer. |
| #5476 | Deferred: too large | The Qoder port spans gRPC, token refresh, billing, images, registry, model APIs, dependencies and many tests (over 1,500 changed lines). |
| #5502 | Not applicable | DurinDoor has no Grok Web video generation route or executor for this validation to guard. |
| #5540 | Not applicable | Closed without merge; closed PRs are not eligible for porting. |
| #5541 | Not applicable | Closed without merge; closed PRs are not eligible for porting. |
| #5547 | Deferred | Changes shared credential selection and dashboard account controls. The repository requires a full independent checkpoint for auth/account-selection changes, which this intake excludes. |
| #5548 | Already in | `/v1/images/edits` is implemented in `src/sse/handlers/imageEdit.js` and covered by `tests/unit/image-generation.test.js`. |
| #5623 | Not applicable | DurinDoor has no ElevenLabs STT/Scribe route or provider configuration to preserve the requested timing fields. |
| #5680 | Ported | `650e812` adds current ElevenLabs TTS models, supported output formats, allowlisted option passthrough, and focused tests. |

Focused validation for #5680: `node node_modules/vitest/vitest.mjs run unit/elevenlabs-tts-upstream.test.js --maxWorkers=2` passed (5 tests). ESLint passed with two warnings for the existing anonymous default export pattern.
