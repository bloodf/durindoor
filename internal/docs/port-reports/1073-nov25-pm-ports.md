# Afternoon port candidates, 2026-11-25

This is a partial disposition. The pending rows require further investigation; they are not final port decisions. PR heads were queried with `gh api`.

| PR | Current head | Disposition and evidence |
|---|---|---|
| 9router #5776 | `f663037a82c7ada99bd4a02b745ea0f9e7761564` | Ported the client version update in `570b0e2b634`; the existing route and fingerprint scope is recorded in [the earlier report](1072-opencode-free-client-5776.md). |
| 9router #5702 | `37ff0d9899fc7a39e02bf1c7ea9687e5c0c97580` | Pending. GitHub rejected the diff with HTTP 406 because it exceeds 20,000 lines. The changed-file API lists 219 files and supplies patches for 218; a per-file comparison and inspection of the remaining file are necessary. |
| OmniRoute #21221 | `547e684a20fff6d6e60256450124becc4e09c43a` | Pending. Live Z.AI model discovery conflicts with the static-only contract in [the acceptance test](../../../tests/unit/fleet-provider-zai-web-acceptance.test.js). The local [discovery configuration](../../../src/app/api/providers/[id]/models/modelsConfig.js) has no Z.AI entry. |
| OmniRoute #21216 | `f4ea855fb46fba5947102da68cb132d8755d2cc4` | Pending. [Credential selection](../../../src/sse/services/auth.js) filters quota-skipped connections. The interaction with locks, cooldowns, and the combo attempt loop needs a behavioral comparison. |
| OmniRoute #21057 | `795836697b799648a72edfcbcae2a4b2677a6235` | Pending. The current upstream diff changes `open-sse/services/contextManager.ts`, which has no corresponding local `open-sse/services/contextManager.js`; the local [compression seam](../../../open-sse/handlers/chatCore/compressionHook.js) has separate cached-prefix protection. The remaining behavior needs comparison. |
| OmniRoute #21033 | `c4e74c03f619e8084d5a3a8149ece0fdffd1bcce` | Ported the offline postinstall behavior in `79363d4707f`. The [focused test](../../../tests/unit/port-omniroute-21033-offline-postinstall.test.js) checks that a missing runtime does not invoke npm. The upstream Bun container path is absent; its dependency and CI changes were outside the requested scope. |
