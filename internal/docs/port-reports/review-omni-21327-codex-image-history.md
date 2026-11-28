# OmniRoute #21327: Codex dedicated image call-history privacy

## Verdict

**Intentional/inapplicable for DurinDoor’s current architecture.** This is a bounded logging change to OmniRoute’s dedicated Codex Images API handler and its image-result call-history writer. Those modules and the dedicated call-history row path do not exist in either requested DurinDoor tree. DurinDoor routes Codex image generations and edits through its shared image adapter/core and records usage through the gateway ledger. No equivalent dedicated call-history persistence was found to port.

This agrees with the existing disposition in `omni-review-catalog.md` (“Not applicable”; dedicated `imageGeneration/` handler absent). The later full parity refresh’s “Unrecorded at this head” entry is intake status, not evidence that the earlier disposition changed. No active claim for #21327 or this dedicated image-history behavior was found in the searched port-report records. This review does not claim that every local image log is metadata-only: the shared image core has debug messages containing a prompt prefix, but that is a separate runtime logger path from the call-history detail persistence changed by this PR.

## Upstream evidence

Read-only `gh api` inspection of [OmniRoute PR #21327](https://github.com/cheaper-inference/OmniRoute/pull/21327) returned state `open`, base `release/v3.8.55` at `16e2c146fb5b8e4ee6364fb679ffe412880757fb`, head `fix/codex-dedicated-images-log-privacy` at `428ebc68f199b300f2d0a89c8d10c3a804793778`, and four changed files (176 additions, 48 deletions).

The changed paths are:

- `changelog.d/fixes/0000-dedicated-codex-images-log-privacy.md`
- `open-sse/handlers/imageGeneration/providers/codexImages.ts`
- `open-sse/handlers/imageResult.ts`
- `tests/unit/codex-images-dedicated-endpoint.test.ts`

The handler removes prompt/image request details and response details from dedicated Codex image call-history entries, uses fixed diagnostics for failure rows, and retains result attribution. Its test additions cover success and HTTP 422 row contents, plus direct/combo generation/edit attempt counts and key/connection attribution. The PR body reports 43 scoped tests across this file, image usage accounting, and combo image tests; no local execution was needed for this static applicability review.

## DurinDoor tree evidence and trace

Compared `origin/main` at `29490b783e83176d4d6a4162f76ee3dc79db66ea` and frozen train tree `32a783d76d45d90bf0517015442f43fadd96106c` using Git tree objects. Both contain `open-sse/handlers/imageProviders/codex.js` and `src/sse/handlers/imageGeneration.js`; neither contains `open-sse/handlers/imageGeneration/providers/codexImages.ts` or `open-sse/handlers/imageResult.ts`.

In both trees, `src/sse/handlers/imageGeneration.js` calls `handleImageGenerationCore` for routed image requests and sends successful image results to `recordImageUsage` (including the selected connection ID). `open-sse/handlers/imageProviders/codex.js` implements Codex hosted image generations/edits through the Responses API image tool, not OmniRoute’s dedicated `/backend-api/codex/images` handler. Shared accounting therefore follows the gateway usage ledger and has no counterpart to the changed dedicated call-history row writer. The integration is architectural and evidenced by the same paths in both snapshots; no provider-specific history behavior was inferred from absent filenames alone.

## Disposition

Do not implement this PR as a port candidate. Revisit only if DurinDoor adds the dedicated Codex Images handler or dedicated image call-history persistence. No severity or corrective test applies to the current architecture. No production files, issue tracker records, or PRs were changed. No tests were run.
