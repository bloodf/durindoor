# Pending open upstream PRs without a current disposition

Retrieved from paginated GitHub `gh api` open-PR results at 2026-11-25 15:54:21 UTC. 1,076 PRs: 9router 735 and OmniRoute 341.

How matched: took the PM report rows marked “pending, not evaluated” (earlier-head-only or found only in inventories), then matched by repository and PR number to the current paginated open-PR results for head SHA and title.

## 9router

| # | PR | Current head SHA (full) | Title | Why pending |
|---:|---:|---|---|---|
| 1 | #5840 | `ceb5db8f32637cd950558660b2a2e043219d6189` | fix(stt): forward timestamp_granularities to OpenAI-compatible STT upstreams | inventory-only |
| 2 | #5839 | `9ae095ff628b2c1295da041f040313b1e39fea16` | fix(server): detach and close socket on h2c downgrade finish | inventory-only |
| 3 | #5838 | `3a69db97c8e9ce33da1e53ec9b1579f2e6dd4378` | fix(transport): include prime256v1 and secp384r1 in default TLS ECDH curves | inventory-only |
| 4 | #5837 | `b1857d67b9ef88e16f3c8638263200b9388e3046` | fix(gemini-web): parse Cookie-Editor JSON, persist rotated cookies, fast-fail 403 images | inventory-only |
| 5 | #5836 | `515f25e00057c44eb90332a617aa115ffa10e430` | fix(gemini): strip thinking suffix from URL and preserve schema properties | inventory-only |
| 6 | #5834 | `e546a7a1e2f95c81dba71c3316885da8ccfac35a` | fix(codex): strip unsupported uniqueItems tool schema keyword | inventory-only |
| 7 | #5831 | `ea378f6ee95e5cc13ceb8676d7d9ceface15508f` | fix(chat): preserve upstream status instead of hardcoding 503 | inventory-only |
| 8 | #5829 | `fcffbb93c39f2fdf255297c288e13c67202424f3` | fix(startup): initialize app services during Next.js boot | inventory-only |
| 9 | #5825 | `6827da3883210199d81279b0670062da4c7a751d` | fix(combos): import System One configuration link | inventory-only |
| 10 | #5771 | `1cf58c3b9b18b72214e8aebdeba30737710cab12` | feat(observability): per-API-key usage and cost metrics via OpenTelemetry (OTLP push + optional /metrics) | inventory-only |
| 11 | #5767 | `c2a41913f33c0c85436aedfd9a715ced7870d8ea` | fix(transport): raise the happy-eyeballs attempt budget above one RTT (#5721) | inventory-only |
| 12 | #5758 | `7fdfe8f15aead4119d3c00eaf83693338064a222` | Provider Account Auto Ordering | inventory-only |
| 13 | #5755 | `56c241cb77b6a84d4a3842980611ffc30e1001c2` | Reduce Docker build time and image size | inventory-only |
| 14 | #5751 | `53546d5ab590863706eee1fc6626f5390bc09eb9` | feat(codex): support GPT 6.2 Sol and Astra with tool schemas | inventory-only |
| 15 | #5744 | `0011fc8aaeb0e80c5e43431405cc926762bba936` | fix(stream): don't let the usage estimate override real passthrough usage | inventory-only |
| 16 | #5743 | `c91d644c7c3ac5f2435b40b79e7776ac875ec865` | fix(stream): forward Claude cache usage to OpenAI-format clients | inventory-only |
| 17 | #5742 | `8836166c105effc95450525d444b335e5cac584e` | feat(codex): per-connection Ultrafast toggle in quota tracker | inventory-only |
| 18 | #5740 | `7cc033e11657459ff6cb2815ac88562f45e68143` | fix(sensenova): add thinking and vision support and update API key link | inventory-only |
| 19 | #5737 | `b9d0d96d9a048dcea1dcd346aa0b03e1fa79d25f` | feat(openai,codex): add GPT-6.2 Sol and Astra for API and subscription | inventory-only |
| 20 | #5733 | `063c394fa416b613b6160b225f2828e47cf75f4e` | fix(antigravity): strip Claude Code stock sentences that trigger fake 429 RESOURCE_EXHAUSTED | inventory-only |
| 21 | #5731 | `96ad0cad403aabcf79e23e3721265f04ea36cb56` | feat(providers): custom outbound headers for compatible nodes (core) | inventory-only |
| 22 | #5730 | `60402b540b4b4fb9479f6c130ca0d991757b2759` | fix(cloudflare-ai): keep image parts for vision models instead of dropping them | inventory-only |
| 23 | #5729 | `c6522f9e449872f6fefe6009da12be05a183a046` | fix(provider-nodes): report an unreachable node as a validation result (#5721) | inventory-only |
| 24 | #5728 | `625a274237cfd46273cbcb919e011d142a76e94a` | fix(chat): treat an absent stream as non-streaming (#5677) | inventory-only |
| 25 | #5727 | `d1cb1edb27a40d8c9f9b505e68871d23ba549849` | WARP hop engine: rotate outbound /64 on rate limits (from openhop) | inventory-only |
| 26 | #5725 | `68470e531768dcfeba095cda24ebd50b25ed5905` | fix(opencode): bypass free-tier client fingerprint gates for non-OpenCode apps | inventory-only |
| 27 | #5712 | `b6afd89941e580ec1c5fdcaedbbcbd14ffc226f7` | fix: tray handoff child must not SIGKILL its parent | inventory-only |
| 28 | #5711 | `882ffa54465fac1968acf6f75fdd7a93593ab526` | feat(dashboard): make update notifications optional | inventory-only |
| 29 | #5707 | `f0d370a642480762ce5fbd75dd6454440a77a9a2` | fix(nous): tag API-key requests through the built-in nous provider | inventory-only |
| 30 | #5706 | `183fd7e778a89e389b807aebec783870d88d37ac` | fix(translator): send Responses tool-output images as image parts, not text | inventory-only |
| 31 | #5691 | `6fbcf48c3cd2ffaab239bba3c6575b8d8596ebbe` | fix: bump package.json version to 0.5.119 | inventory-only |
| 32 | #5688 | `63d346c3e5a356277e405a56dbe1312107c49ffa` | fix(antigravity): back off suspended connections on TOS violation and validation errors | inventory-only |
| 33 | #5685 | `e870f2d25c4d9192dc046bfb9822c2342184d520` | fix(stt): forward timestamp_granularities in OpenAI-compatible transcriber | inventory-only |
| 34 | #5684 | `4e9bfccaf90dfe0a230b39579201f5e98f3c33e6` | feat(quota): add Antigravity auto-ping service and dashboard controls | inventory-only |
| 35 | #5678 | `bedf140d74065f94eecaa22b3be46cf26fc6f55a` | fix(synthetic): icon, model import button, weekly credit quota | inventory-only |
| 36 | #5675 | `d466760b46f624f1fe19809b950d3ab62527a106` | fix(rtk): compress tool results in Gemini and Antigravity formats (#5674) | inventory-only |
| 37 | #5673 | `9ee534ea81095bceca6d3bf65088af385d516474` | feat: add AvalAI provider with 50+ models | inventory-only |
| 38 | #5669 | `335c5ea60f20ac11e97cd7d496bf1905e7bb4764` | fix(executors): nest reasoning_effort for openai-compatible responses nodes | inventory-only |
| 39 | #5660 | `5175313d300e510859b805e06413e8429b32b49c` | fix(antigravity): preserve paths and identifiers in opencode prompt rewrite | inventory-only |
| 40 | #5658 | `ccf12b56365dc350263a19233276dd3dba621c8b` | fix(browser-pool): preserve active request pages | inventory-only |
| 41 | #5655 | `fa407b2f9e6d807409cbeaffe31e460714ee11bc` | feat: add opt-in Antigravity desktop BYOK routing and Windows controls | inventory-only |
| 42 | #5653 | `aa455b7bce5f4cf1fd941dd0b332309979a2b36b` | fix(release): prevent version drift and tagless CLI publication | inventory-only |
| 43 | #5651 | `1dd5ee59d5c68f71506c3861b72efb3011496148` | fix: bump root package.json version to 0.5.119 (tag v0.5.119 fails docker-publish validation) | inventory-only |
| 44 | #5623 | `b7829a551686a09ccb6e49af292b65da97fb5e83` | fix(elevenlabs): preserve requested JSON transcript timings | inventory-only |
| 45 | #5622 | `22f97612532ce24437f7f39b1712e6a353aff46a` | fix(kiro): pass Kiro's client-version gate and the AWS OIDC TLS handshake (#5613) | inventory-only |
| 46 | #5621 | `caeb89380f49ff54cb23a0d523fe75105b354821` | feat(usage): account filter and a filtered totals footer on the Details tab | inventory-only |
| 47 | #5617 | `68dd679fbc604e2793a5674545530b16f14631e6` | feat(providers): show per-node icon for compatible providers with generic fallback | inventory-only |
| 48 | #5615 | `3885e4ff8c56bbb2cb89474b28c61e4dbf01ebb9` | fix(kiro): update client identity and TLS negotiation | inventory-only |
| 49 | #5611 | `68ff444b7acb03b943ab519670a1fbc2aae7e436` | fix(thinking): nest reasoning effort for OpenAI-compatible /responses nodes | inventory-only |
| 50 | #5609 | `b20a880701d66ba217daf369ea37696ce6b6259a` | fix(stream): send overloaded_error for mid-stream aborts to Claude-format clients | inventory-only |
| 51 | #5604 | `bf4032749b97459180bc409d853c30c531de4295` | feat(web): add Keenable keyless search and fetch provider | inventory-only |
| 52 | #5603 | `5e2c6fe57d9143713f5d3f8e853e2b4bc612451d` | fix(translator): resolve the auto thinking intent on OpenAI wires | inventory-only |
| 53 | #5589 | `991392b18ac595be4955ac5df031edf5a70351ef` | fix: preserve reasoning.effort for Responses API | inventory-only |
| 54 | #5587 | `3debae36da2e4686912ebb4b76f9c1db79a7e54b` | chore(docker): shrink build context and avoid recursive chown layer | inventory-only |
| 55 | #5574 | `c33e53c2196df817238c6950e06b2cc254c93ad7` | feat(combo): Smart Router routing rules and per-combo system prompt | earlier-head-only + 800-scan-reconciliation.md |
| 56 | #5529 | `ce0141043e80a9023dfbee44e8221facaa4ea93d` | feat(antigravity): align tool execution data bridge and thinking effort tiers | inventory-only |
| 57 | #5528 | `b25c4ee9c8b02e70d8af400741b24c4735348359` | fix(proxyFetch): send FormData bodies as multipart via undici | inventory-only |
| 58 | #5518 | `c437a9ec5408f50ed595e5e25168f1a79547e0b2` | fix: preserve reasoning for custom Responses providers | inventory-only |
| 59 | #5515 | `0e452030a934914397959c180b3d212a0496dd75` | feat(providers): add JembatanAI provider | inventory-only |
| 60 | #5492 | `b241d41652a806b7cbd16f1c96110fafedb4022a` | fix(providers): align batch tests with dashboard provider groups | inventory-only |
| 61 | #5490 | `ecf61fcde5b91d67f28a3436945187b0fc10e009` | fix(providers): allow explicitly keyless compatible endpoints | inventory-only |
| 62 | #5488 | `519c7c9bf848212c606c74d7e7a81d4efefe8f91` | fix(translator): normalize colliding assistant reasoning aliases | earlier-head-only + 800-scan-reconciliation.md |
| 63 | #5476 | `19a7d87d12dc46e9cf506a56d6c04a0902c0a020` | feat(qoder): long context over gRPC, token recovery, billing UX, and working image input | inventory-only |
| 64 | #5466 | `93239483eaf3e42fd36cf8f80d875826f949b7a0` | feat(combos): order combo models by aihot.news leaderboard presets | inventory-only |
| 65 | #5452 | `f3cb0632a6fa27bf5849b0c8b4a59460a93a1e0c` | feat(providers): batch active, disable all models and free only button in provider models management | inventory-only |
| 66 | #5437 | `37de46a1b866338f39ef98ca61e80e6f7b387b52` | feat: add Kiro executor for handling SSE streams and tool calls in open-sse | earlier-head-only + 800-scan-reconciliation.md |
| 67 | #5436 | `f475fe71babbbf10eccc1278b34e927c390ebb12` | fix: add deepmerge override for GHSA-gcqx-w48m-w2h4 | inventory-only |
| 68 | #5431 | `7928918ef6ec98726c5b95f6da7684d10683cd9e` | fix(anthropic): drop Claude Code identity system block on API-key requests | earlier-head-only + 800-scan-reconciliation.md |
| 69 | #5415 | `7a660d6720c17d66838970ed2c04f20bed819264` | fix: normalize final Claude assistant whitespace after compression | inventory-only |
| 70 | #5381 | `ae46e3c2712bdf52efeef7cadc53fe388c487dd9` | fix(opencode): clean in-process TLS session lifecycle and v2 wire fingerprint | inventory-only |
| 71 | #5373 | `272669dd49dfe7b701fea65b663290142fc3d671` | fix(cloudflare-ai): don't send width/height to FLUX.1 Schnell | inventory-only |
| 72 | #5372 | `329fe5537eb122ebae9c1995e94c829096f4d7c4` | fix(images): derive binary Content-Type from image bytes | inventory-only |
| 73 | #5370 | `30d6153a6b956a58100d2afac4fddeca55e011a0` | fix(proxy-pool): route media and MCP traffic through the configured pool | inventory-only |
| 74 | #5355 | `3a34356dbc9c9572ff9380ba88c1471e4fd7a2ad` | fix(thinking): floor MINIMAL tier on tiered Gemini 3.6/3.7/3.8 flash | earlier-head-only + 1072-model-capability-residuals.md |
| 75 | #5350 | `c9f6db7e02367da74cb360506dc50b2fbcb983ac` | fix(cloudflare-ai): forward FLUX.2 reference images | inventory-only |
| 76 | #5349 | `b106700c2ee78c18c0eeac09072a7ef10f9f2e07` | fix(stream): drop empty tool-call deltas before assigning ids | inventory-only |
| 77 | #5347 | `ab232d912a24383302b19e60ddbb0a4344c5f202` | fix(v1/models): resolve combo seat provider identity from live connections | inventory-only |
| 78 | #5344 | `93c0067781d21bbea0ba793de10bec1595fdc883` | fix(claude): preserve native omitted and redacted thinking | inventory-only |
| 79 | #5343 | `4a7ff093b791e7e3a00bb3edfaac87bb14a9a6eb` | feat(providers): add HCNSec (hc) OpenAI-compatible gateway | inventory-only |
| 80 | #5342 | `5676ba81b46d6ec2d481b56e36396316ea280314` | fix(codebuddy): support WorkBuddy ck_ API keys across headers, test, validate, usage, and plan-restriction fallback | inventory-only |
| 81 | #5338 | `bfb5334c74d42e90e4260ae386d70594a1b95ce3` | fix(opencode): avoid total timeout on streaming responses | inventory-only |
| 82 | #5335 | `6d04174b0e26de70f7e60a4fb0ea6b6e4f211eed` | fix(quota): stack quota rows on mobile | inventory-only |
| 83 | #5331 | `8687755f135ac243f5ddbf46fb8d1466ccfad3e5` | fix(combo): treat reasoning streams as non-empty | inventory-only |
| 84 | #5330 | `3940975dcda275777baa54419fe2bfb8356d56d3` | fix(translator): normalize Antigravity ProtoJSON schema integers | inventory-only |
| 85 | #5327 | `de85ae67ec0295c5f847031e678a6ca88f23d994` | fix(muse-web): resolve addCookies invalid cookie fields error for __Host- prefixed cookies | inventory-only |
| 86 | #5326 | `749780950fc34ed738dd3bf1d5facd30cb81f650` | fix(streaming): keep alias-shaped reasoning deltas on OpenAI passthrough lanes | inventory-only |
| 87 | #5324 | `318edf79ada0bc4b687a17a7b049a746980aca2d` | fix(chatgpt-web): forward auth headers for estuary image download and ignore upload placeholder | inventory-only |
| 88 | #5323 | `6e91003d68b9f6cfbb314f66c1d6a65fd51a4d64` | feat(tts): add custom TTS models from the dashboard | inventory-only |
| 89 | #5322 | `4017124784c0693cbbd7fc59c8a24cd401645472` | feat(output-rate): add output rate calculation and display in request details | inventory-only |
| 90 | #5321 | `4b166f0e8c235606f6d16285b89f3bc5bf7faa44` | feat(tts): add Gemini 3.8 Flash and 3.8 Flash Lite TTS models | inventory-only |
| 91 | #5320 | `9ed65b8bb40d30db9e2b65e744d06baf688ed662` | fix(chat): view generated captions when streaming is unspecified | inventory-only |
| 92 | #5313 | `92d8898c58158f0f55e8bf8b96f4f4e8afb207fe` | feat(headers): expose served route in response headers (x-9router-provider / -model / -combo / -attempts) | inventory-only |
| 93 | #5312 | `a9ed53b9bab3e92503136364b00157df6376a3a1` | docs: add SECURITY.md for private vulnerability reporting | inventory-only |
| 94 | #5311 | `6b12f32a41c64f343962419e3b028653f4917350` | fix(bedrock): normalize Responses reasoning and Claude adaptive thinking | inventory-only |
| 95 | #5308 | `1256c2f8aa4142e9b80e71bc5fe3df54f04f0445` | fix(qwen): 3.8 vision caps + official reasoning_effort thinking format | inventory-only |
| 96 | #5298 | `7db4acfebf6723e0c8debceac39c7bb29792e6fc` | feat(opencode): native client-mcp service bridge with PATH-aware UI toggle | earlier-head-only + 1072-composite-open-residuals.md |
| 97 | #5286 | `34f45274e61f14f4e84e6f137095f3a7c49575f8` | fix(db): stop ENABLE_REQUEST_LOGS from overriding observability | inventory-only |
| 98 | #5280 | `5c5bf68846f4c8d47aeb63da8f58e7f323ba64df` | fix(responses): preserve Copilot context overflow errors | inventory-only |
| 99 | #5279 | `29c4faf46850fd0d5b0ca58595396710d75fb8b1` | fix(codex): harden Responses routing and request handling | inventory-only |
| 100 | #5277 | `ca882a2cd6f41d5bd46f1997b587f98c405e769b` | feat(combos): add Tokenmaxxing quota-aware strategy | inventory-only |
| 101 | #5276 | `5a2e73edfe9a5f5625309cb2569c87389c3deb94` | fix(executors): end stalled upstream SSE streams instead of hanging | inventory-only |
| 102 | #5266 | `21e36858cb6f165f64e2888a475cc1b05cdcfb3f` | Sync decolua v0.5.111 | inventory-only |
| 103 | #5264 | `4a638cfdec8a06d17015ea405b9bce4b818d307f` | fix(server): extend idle HTTP keep-alive timeout | inventory-only |
| 104 | #5250 | `2178afe8494c193094bd8f1426f391c5ec85b36a` | fix(translator): return Claude-compatible messages for non-streaming responses | inventory-only |
| 105 | #5246 | `5c12756fa622829c1adfb06d3d85a7d0c43bb775` | feat(combos): add batch model testing for dead/alive checks | inventory-only |
| 106 | #5241 | `26958f5372b5a3c32eb863152d5f788d91b879ed` | fix(models): sync models.dev limits for every gateway-listed model | inventory-only |
| 107 | #5240 | `3753db1d68f15224de21f5e47daf9c2b67e42cd9` | feat(webhooks): add operational webhook alerts | inventory-only |
| 108 | #5239 | `74f75a7712621411c5f8692aa17d432a5babe431` | test: align stale suite expectations with current runtime | earlier-head-only + 1073-june3-row-dispositions.md |
| 109 | #5238 | `ff16d46345caa9bc28c3238a9a3b30007187bc9b` | fix(oauth): harden Cursor auto-import database access | inventory-only |
| 110 | #5237 | `5ebe7295f0bc347c5951c38a1390f9a841ecb410` | fix(combos): detect web_search tools for capability routing | inventory-only |
| 111 | #5222 | `e1add8a0a350e25b58380e8486e5acc491bb61f1` | Fix OpenCode free-tier 429s from Claude Code (session timestamps + CLI fingerprint) | inventory-only |
| 112 | #5217 | `4b20f4083d1a66c338859538844f61fc15698497` | fix(codebuddy-intl,cli): unblock cbai/* models and keep the build-machine home out of the package | inventory-only |
| 113 | #5206 | `a78f3f454aab5a99eb025aa8819dc3c13284a1f5` | feat(combos): add per-combo Smart Router instructions | inventory-only |
| 114 | #5203 | `fe601c799ea2b5fa28b98f18360ae0a48b6bfc63` | feat(keys): add per-key token saver controls | inventory-only |
| 115 | #5200 | `e3df0912a7ba4e8803a7607824504a20d20c3de1` | feat(keys): per-API-key budgets, expiry and usage reports | inventory-only |
| 116 | #5166 | `4a1ef184ccfc0898480f2324901223351e30322e` | fix(headroom): rewrite dashboard absolute paths under the proxy prefix | earlier-head-only + 1073-late-june-recovered-3-dispositions.md |
| 117 | #5163 | `48df596d30eab07824581fd5ca40ae4d23198d56` | feat(dashboard): add bulk model testing and disable failed models action | inventory-only |
| 118 | #5148 | `8e14a51c3c5063aae6dc412ee6eb19261e208e6a` | feat(cli-tools): let Codex models set a context window | inventory-only |
| 119 | #5135 | `c0c23a1c722da59e6c4c99ee76cf8e2add89f3fe` | fix(grok-cli): forward reasoning effort for Grok 4.6 and 4.7 | inventory-only |
| 120 | #5134 | `85d2a8424d5815871900e184dc7b12691d3e383f` | feat(grok-cli): list the missing Grok CLI models, drop redundant effort aliases | earlier-head-only + 1073-late-june-recovered-3-dispositions.md |
| 121 | #5133 | `27277a06a962ee2d411163668617f1c1509f7e99` | feat(rtk): add tsc, vitest and phpunit test-output filters | inventory-only |
| 122 | #5132 | `7e6c7aec28390af0e1c905f33865898501051237` | fix(codebuddy-intl): send X-Conversation-* family to pass channel verification | inventory-only |
| 123 | #5131 | `a5e28d056b875803c1867cd66f0274fbe2c0d77b` | fix(cli): only kill the next-server that runs from this install | inventory-only |
| 124 | #5130 | `7034acd5b0e32d15bf345aadd77465f4e91c6bd5` | fix(combo): read a JSON body behind an event-stream before calling it empty | inventory-only |
| 125 | #5129 | `c314672324593bada1820ca0a7b2e4de4765e494` | fix(claude): accept current CAIS/CAQS thinking signatures; keep prior thinking only for Claude targets | inventory-only |
| 126 | #5127 | `322a2413cec97cc9cabb41729f0cbf49daac49c1` | chore: untrack CLAUDE.md and ignore per-machine agent config | inventory-only |
| 127 | #5124 | `dc7cedebc9d0f5af7b6b5d03c3cebdbcdff31059` | feat(models): expose per-limit capability provenance | inventory-only |
| 128 | #5117 | `e320d81fa1ded3bf8160dc7ee9cb139b471a01ed` | fix(usage): do not fold Claude cache tokens twice in canonicalizeUsage | inventory-only |
| 129 | #5100 | `37c28521da681c424965b0c4aeb6f0f3c728d1c5` | fix(models): resolve provider catalogs in the background, not on request | inventory-only |
| 130 | #5096 | `eb851bb218b25bd9d0faa18ea3d13a9528f294c4` | feat(combo): add fastest strategy ordered by measured tokens/s | earlier-head-only + 1073-late-june-recovered-3-dispositions.md |
| 131 | #5093 | `df2cf85a48d21c198ff07a10d11cf0df8846c7ae` | feat(observability): runtime-controllable raw frame logging with retention and credential masking | inventory-only |
| 132 | #5091 | `c9fb9ff848334d245e077bed00d70d89b13dca43` | fix(auth): accept a valid key from any presented credential; key access follows it | inventory-only |
| 133 | #5082 | `a9c11a78b6249eecf82065026ecd1c9643b93b68` | fix(translator): fix GPT/Codex tool schema errors from Antigravity | earlier-head-only + 1073-late-june-recovered-3-dispositions.md |
| 134 | #5070 | `986d9058a24c59124e0696b15d554f38384dc182` | fix: handle NVIDIA API text parameter and model prefix for Nemotron 3 Ultra | inventory-only |
| 135 | #5064 | `80e3c70e06c13c9fbac43fccea317a9efa28e668` | fix(thinking): preserve explicit Step reasoning effort | inventory-only |
| 136 | #5054 | `d6040bbb0d41077a176d8d423aad1e001c5470a8` | fix(fallback): rotate accounts on transient gateway statuses 408/425/499 | inventory-only |
| 137 | #5053 | `a6d8e0477d4ad5057fa306724476030a585c6a27` | fix(combo): publish minimum output capability limits | inventory-only |
| 138 | #5032 | `65a3faa7e165e5d17bab0bab181a75ee1b21a4ee` | fix(codebuddy): resolve HTTP 400 (code 11128 "request illegal") channel verification error | inventory-only |
| 139 | #5019 | `860081386ed8eb92f37241aca05f1d810ec5c10c` | fix(api): decode zstd-compressed JSON request bodies | inventory-only |
| 140 | #5010 | `5fbca0f1568681a0c51cd87e9e7993745d082b47` | feat(usage): live mode toggle with animated counters | inventory-only |
| 141 | #5009 | `823db1c224314ec2919689ff78252e3767f8bd70` | feat(usage): default the table sort to most recently used | inventory-only |
| 142 | #5006 | `05a22aff0395ad4653a2868dc1fc6ece9c36e90c` | fix(commandcode): keep one session id per conversation and report cache reads | earlier-head-only + 1073-late-june-recovered-3-dispositions.md |
| 143 | #4991 | `cac6299406659572f65de1da6655874dfaae1aff` | feat(opencode-go): add gemini wire transport and support gemini-4-argon-contributor | inventory-only |
| 144 | #4989 | `91f0e634f82187304c96a12d2c29105a520f4cda` | feat(models): publish human-readable display names instead of raw ids | inventory-only |
| 145 | #4988 | `16f776dddfa96d59eb91f85e79d59b4d1fa69dc3` | fix(opencode): replay a proxied 403 FreeTierError once on the direct egress (#4983) | inventory-only |
| 146 | #4976 | `f1ec4726524c25fe0147346daa84f905ebb9d1c3` | fix(codex): normalize numeric tool schema values | earlier-head-only + 1073-late-june-recovered-2-dispositions.md |
| 147 | #4973 | `a4394d17056fd8b4917277d9af736d6846db978f` | fix(translator/gemini): sanitize empty strings in tool enum definitions | inventory-only |
| 148 | #4970 | `996dc1fe6acb60ffc3288b3f9f6cde082b68ce93` | feat(ha): add writable peers and safe client failover | inventory-only |
| 149 | #4968 | `b0e210825836448e77d99bb77dc950f1fb3da9c6` | feat(cool-website): add static landing page starter | inventory-only |
| 150 | #4967 | `07478b9105557ed6012e3a9f9c691e4115190c2c` | feat(i18n): complete the Turkish UI translation (1644 strings) | inventory-only |
| 151 | #4965 | `cc02720777d67d7982f595c5dcc3c3f3eb4498fb` | fix(quota): don't leave throttled Claude accounts spinning on auto-refresh | inventory-only |
| 152 | #4960 | `868f9140d32d45bdb0f17ad462a0c2d93857aaa4` | feat(models): manage provider imports and persisted model metadata | inventory-only |
| 153 | #4959 | `ddbf135f17316829e5dc9a74d10a2477311114d7` | fix(cline): exclude ClinePass IDs from the regular catalog | inventory-only |
| 154 | #4958 | `167d726170f54b2284734e95a5245a0eb0dd00d8` | fix(fallback): do not cool down accounts for malformed 400s | inventory-only |
| 155 | #4957 | `5e0bb52d7d5f95d876e7e320745c5235c72f1aaf` | feat(cloudflare-ai): report daily free neuron allocation | inventory-only |
| 156 | #4956 | `87e82355764c3daecb561576eb58974a7e5f3b05` | feat(cloudflare-ai): discover account models with inference IDs | inventory-only |
| 157 | #4955 | `709674ffa6f0d91b77827103dac157ceb4ff9c20` | fix(kiro): advertise canonical models without synthetic duplicates | earlier-head-only + 1073-late-june-recovered-3-dispositions.md |
| 158 | #4954 | `9aa952c160a81a55ef3615869b1c2a6810fa0c0a` | fix(models): preserve configured catalogs in /v1/models | earlier-head-only + 1073-late-june-recovered-2-dispositions.md |
| 159 | #4953 | `df23e9847a771eacca9ecfd16b88f1417851cf98` | fix(security): guard the GitLab PAT user probe against SSRF | inventory-only |
| 160 | #4951 | `91af28faa8a63e3add5a947bd275b1df5c9e6730` | fix(github): wrap a bare string embeddings input into an array | earlier-head-only + 1073-late-june-recovered-2-dispositions.md |
| 161 | #4949 | `08bb2dc1df85a93253763376d161348d27ceb08c` | fix(codebuddy-intl): 对齐 WorkBuddy AI 国际版出站身份，补会话头族（面向 11-128 渠道校验） | inventory-only |
| 162 | #4947 | `62fcff6a4f6d94b97455ed213a8806421bf1ae40` | fix(combos): revoke deleted combo grants from restricted keys | inventory-only |
| 163 | #4945 | `923a176a0c3817caab84236bbe303d79e5f6bb34` | feat(quota): add configurable per-account quota guards | inventory-only |
| 164 | #4944 | `5bcefe80313d0f5f1885db2fb075d87a7101513d` | fix(codebuddy-intl): send the X-Conversation-* family to pass channel verification | inventory-only |
| 165 | #4943 | `81beaadbb2cbbda8cea2e7a73ee6d152ed5c83af` | fix(providers): add dynamic model catalog and import for Nous Research | inventory-only |
| 166 | #4942 | `0ab12983a1bb6d2225994aeda7c941a1968e1170` | fix(capabilities): Step-5 context is 1M, not the stale 128k pin (closes #4941) | inventory-only |
| 167 | #4938 | `61dbccbe7e4e96648e79c7edcd9637d6e659a0ec` | fix(claude): normalize custom tool input schemas | inventory-only |
| 168 | #4937 | `15033ed69e2ad74de82e7b5e033de10dbd3f790c` | feat(checkin): opt-in daily check-in for free-credit providers (codebuddy / qoder / minimax) | inventory-only |
| 169 | #4935 | `be261c1fefea7ba47f6aec0056f88ac860fac198` | fix(auth): honor exact resetsAtMs across all providers without truncation | inventory-only |
| 170 | #4934 | `64492c7e21eff6a4130a30c46cfde0daf243bb20` | feat(antigravity): support unadorned Gemini 4 Argon, quota isolation, pricing, and pdf input | inventory-only |
| 171 | #4933 | `c406310b63f8ac86f9a494f8022d96ca2f853597` | fix(codebuddy-intl): send X-Conversation-ID header family to clear 11128 | inventory-only |
| 172 | #4932 | `9461a36a6d6192a795dd169a9b4ffb0f8d725bbc` | fix(codex): preserve search history during tool-free compaction | inventory-only |
| 173 | #4930 | `144cd088c352adc07239762985b6c4dd67abe783` | fix(translator): preserve Claude streaming tool-call IDs | inventory-only |
| 174 | #4929 | `c263809fda1f4e5153ee5e1aee815226509f25a6` | feat(providers): support custom JSON API endpoints | inventory-only |
| 175 | #4928 | `26d0cb0ddd53fae85c31fc8900e05d7d394493ae` | fix(codebuddy-intl): send X-Conversation-* header family to pass upstream channel verification | inventory-only |
| 176 | #4887 | `4aadeea762bb709da35e605e372648f77297a89f` | feat(models): add Gemini 4 Argon across gemini, vertex, gemini-cli and antigravity | earlier-head-only + 1073-late-june-recovered-2-dispositions.md |
| 177 | #4886 | `51ec6f91b9e54bfe88871ca58b12646596054d7e` | fix(combo): advance the chain on seat-scoped request errors | inventory-only |
| 178 | #4885 | `b8797cb16fc113b1678e5a6df8b4aa984d880285` | fix(translator): separate Responses reasoning summary parts with blank line | inventory-only |
| 179 | #4883 | `2497d88cf81d99a396051aba955e8ff196e31886` | fix(opencode): refresh the client fingerprint to the 2.0 channel form | inventory-only |
| 180 | #4882 | `a513b3d7155b93b7b6453e88168882c4623d8465` | fix(translator): keep functionResponse and trailing text in separate user turns | inventory-only |
| 181 | #4879 | `bb303332ad859bfc49bd9d8d1d44f0121847a507` | fix(config): treat context-overflow 400s as fallbackable in combos | inventory-only |
| 182 | #4878 | `f343d47c5dbd5b03d9d691211fa1c2d1d5366517` | fix(providers): move GitHub embeddings off the retired models.github.ai host | earlier-head-only + 1073-late-june-recovered-2-dispositions.md |
| 183 | #4877 | `02176c1461f4e48d6665222c7285ea54e70b760c` | fix(thinking): include budget_tokens when zai thinkingFormat enables thinking on the claude wire | inventory-only |
| 184 | #4867 | `61bfc9c62cf16431831283ef72454597444359c9` | Fix Cursor conversation history delivery | inventory-only |
| 185 | #4864 | `83e5a54a6a78dabcdf7a20c6668e5ae0f0664338` | fix(auth): accept x-goog-api-key as a client key in extractApiKey | inventory-only |
| 186 | #4860 | `91db4700e992a0924a4d2e45aa73897f4fc2e24f` | fix(opencode-zen): align free-tier v2 headers and read/shell fingerprint (#4845) | inventory-only |
| 187 | #4857 | `dbd40ad95434885d013ce4ee96c5feb95cb8c618` | fix(kiro): return Claude message JSON for non-streaming requests | inventory-only |
| 188 | #4850 | `dac5e9a38d35b5b1e569637d7e16134f5a2239c7` | feat(combo): expose actually used model and route attribution headers | inventory-only |
| 189 | #4849 | `8d5a697f2198553d13064f731dde57fe8a688eb8` | feat(providers): add Atlas Cloud as an API-key provider | inventory-only |
| 190 | #4843 | `5f434e8d8db1f46be007eda1515a47298bda9510` | fix(models): report an unreachable or timed-out upstream instead of a blanket 500 | inventory-only |
| 191 | #4835 | `02f89aa33548013a197024e1ce8a903cf7009008` | Handle custom provider prefixes in the terminal model picker | inventory-only |
| 192 | #4834 | `948f12f33f0c8dc6e23bccdbcb3210dd328b2949` | Handle disconnected CLI API responses | inventory-only |
| 193 | #4831 | `fd69dbb5d2603baec05a01146c4e5844d9c4014f` | fix(translator): preserve Gemini tool parameter names | inventory-only |
| 194 | #4830 | `5f22a45df376dfd1049df5e6b19f50591136c853` | Use installed CLI version for dashboard update checks | inventory-only |
| 195 | #4826 | `548c0487ec03856239729f325026dc2f5e21e3ca` | feat(auth): per-API-key provider and account access scoping | inventory-only |
| 196 | #4825 | `03cc1f1104bf362afe7b109b8566a2d86b169833` | fix(dashboard): avoid false timeouts testing reasoning models | inventory-only |
| 197 | #4824 | `a9bdd06953c251bc4f49797e04c9b9e522921c0b` | fix(vertex): strip thinking suffix from upstream model URLs | inventory-only |
| 198 | #4823 | `7355ec14dcce122e2035450094c29c29968e3264` | fix: sync combo fallback status and use compliant Headers in bypass fetch | inventory-only |
| 199 | #4818 | `bdfdb914b96c75b530eb0310c238da8f1ec0fa55` | feat(usage): opt-in full payload view in request details (#4728, #4812) | inventory-only |
| 200 | #4817 | `12970d8bf164f3f97b125cb46d6f7effb7b45aad` | fix(open-sse): mask provider auth headers in request logs (#4808) | inventory-only |
| 201 | #4813 | `9766ce01a84e7d0a6679fb42b28da3bbbdfca86e` | fix(translator): keep every system message when mapping Chat Completions to Responses instructions | inventory-only |
| 202 | #4810 | `8d83ec896ea3e9f61f5733077b8aa41f9e6a371f` | fix(codex): preserve namespace tools and normalize Gemini schemas | inventory-only |
| 203 | #4800 | `87372642011cc4c8aaad4e0acfae3626cfacb29c` | feat(provider): add SubQ Decisions API provider | inventory-only |
| 204 | #4799 | `8323bed69677ee1a894037c07aaa219523d243c0` | fix(capabilities): restore the Qoder capability table — qd/* models lost vision (#4795) | inventory-only |
| 205 | #4798 | `724972f3f8f5ea134190f59e7e2b60fc902fb35c` | fix(gemini): sanitize nested array schemas and empty array items (#3707) | inventory-only |
| 206 | #4791 | `cf5d67afbf36976d532ca261033b488d0791620c` | fix(opencode): mint canonical session ids instead of hashing the downstream id | inventory-only |
| 207 | #4776 | `bcbb24ca9d2d9e76807d3ac340509bb062dc2972` | Fix lỗi truyền thiếu tham số strict dẫn tới các model cx/gpt openai tự động tạo git worktrees khi spawn subagents | inventory-only |
| 208 | #4769 | `030d94a1c8948c8c0f676f60e21dd2a2b015886e` | Save quota visibility per account | inventory-only |
| 209 | #4768 | `001a95d8c206549e3246d7b343e1272a709f09aa` | Catch missed Claude quota auto-pings | inventory-only |
| 210 | #4764 | `a759781a502ce92108351467882734aa030923e7` | feat(keys): whole-provider entries, typed entries and access on key creation | inventory-only |
| 211 | #4762 | `36c04cbf368cc465a4da58dd409cfaa18a12eaaf` | fix(claude): resolve auto-mode classifier non-streaming projection and context model aliases | inventory-only |
| 212 | #4759 | `238d187a753220c7fbd649c876efce18f79cbdf3` | feat(combos): add local deterministic Auto Router strategy | earlier-head-only + 1073-late-june-recovered-2-dispositions.md |
| 213 | #4755 | `7855c003ed76754dec5044b26e433259862bedb7` | feat(keys): show live request/token metrics on API key cards and link to filtered usage | inventory-only |
| 214 | #4754 | `fab06174c4c6ddf5e49a2755a7621a6a6714e80e` | feat(models): smart auto-prefix resolution for standard and custom models | inventory-only |
| 215 | #4753 | `474c73073b7e64afe7344745fc20d388166f584e` | fix(chat): default omitted stream to false and enforce JSON on non-streaming clients | inventory-only |
| 216 | #4746 | `15461307c719017cdd63c75ed9e4c2976c493ca3` | fix(ui): support RTL layout and right-side sidebar for RTL languages | earlier-head-only + 1073-late-june-recovered-2-dispositions.md |
| 217 | #4740 | `504adfa4f35acdc0d19d7372bfa46f62c921d033` | Add ParalonCloud as an API-key provider | inventory-only |
| 218 | #4719 | `ac5614b0a054cedd18c20cb31e45ded56457d741` | feat(cursor): retained sessions, cross-turn checkpoints, lineage + blob archive | earlier-head-only + 1073-late-june-recovered-2-dispositions.md |
| 219 | #4718 | `4b476f95a30ef15c35c716e23a959829fff4dc38` | feat(chat): support x-connection-id account pinning | inventory-only |
| 220 | #4717 | `1d9e5dcca411d506f4f7fac3b5eb3607bb4e1544` | fix(mitm): support Kiro /responses endpoint via OpenAI Responses API | inventory-only |
| 221 | #4716 | `ebb251171c08c5d0b89272458e536f3ffadf49da` | fix(combos): save edits without changing the name | inventory-only |
| 222 | #4711 | `4c7cf84cecb5ba87f7ba3138920b5890abd9ac70` | fix(translator): pair orphan tool messages for Responses continuations | inventory-only |
| 223 | #4708 | `81000acd4c5ba643c49390477c8fd2f971fc0210` | feat(keys): add API key expiration with presets and custom date | inventory-only |
| 224 | #4706 | `1f2902afceb438c6bb251c91d7f56d8ad68e80d4` | fix(github): strip unsupported temperature on Responses requests | inventory-only |
| 225 | #4699 | `833d5081a9d2b6cdfd5b320a9435458869df3e15` | feat(cursor): optional native IDE tool execution for AgentService (default-off) | inventory-only |
| 226 | #4698 | `f1285c118a01e2386064f9006457e02e5bacc19d` | feat(cursor): conversation lineage + blob archive helpers (extractable core) | earlier-head-only + 1073-late-june-recovered-2-dispositions.md |
| 227 | #4697 | `28778fb026e632aab5bcbd535a3ad714197bc684` | fix(dashboard): show typed media models in the capacity-adapter picker | inventory-only |
| 228 | #4695 | `47e3235ccfb47d6b676062f15247942ac1cfeba9` | Parse Anthropic SSE with the Claude parser on the non-streaming path | inventory-only |
| 229 | #4691 | `6b4307301445e11c90f9f69087d967d5b285249a` | fix(commandcode): clamp max_tokens to 200k upstream schema limit | inventory-only |
| 230 | #4688 | `2c3c357f82b1b9a35181b82a72de9410f658f5d3` | fix(ollama): track the new monthly-credit pricing in the quota dashboard | inventory-only |
| 231 | #4685 | `4a34fd9e6b1338c5429ab4a92a04162d6d26c2dd` | feat(search): forward full Exa and Tavily request fields | inventory-only |
| 232 | #4678 | `fcb772adfdab17c14322715ddc3c4ceefe6224ab` | Add health-checked automatic Docker updates with Freshdock | inventory-only |
| 233 | #4676 | `9080794076292766842ef127db32cf48808e64aa` | feat(web): add Parallel search and fetch provider | inventory-only |
| 234 | #4674 | `10cb55ab5dc9e7b950204505a96d4ccf4813f1da` | fix(clinepass): read the live catalog from the recommended-models feed | inventory-only |
| 235 | #4665 | `0b48297c7cd753a7dfefe8fa5507c27bd70eb331` | fix(usage): never persist an estimate over real provider usage | inventory-only |
| 236 | #4658 | `55149ada3cc74d4a7186773eb95b6d94e324c541` | feat(stream): coalesce Anthropic content_block_delta SSE events (off by default) | inventory-only |
| 237 | #4657 | `29c6598494bbfd7e9a4db0b8076006ef83f02b59` | fix(executors): route Responses-pinned models to their /responses transport | inventory-only |
| 238 | #4654 | `ed07689169985aa8498f8ef33d3ad4f9b67ac2a6` | fix(models): advertise Codex v1 multi-agent tools | inventory-only |
| 239 | #4653 | `934e03affd7e8d07e206c2791e4f0fbb90232d2a` | fix(bedrock): strip Grok tool schema keywords | inventory-only |
| 240 | #4652 | `8ee0e7238507cc6da6ad19ddc2badf29b665188d` | feat: model discovery filtering and infra view | inventory-only |
| 241 | #4651 | `2aed1bc5b5462ca08891f3e0c2a4020315e4fb4e` | feat: flag-gated tool-schema relevance ranking | inventory-only |
| 242 | #4649 | `0e27df77215cd283ebd75dc5965315ef11c37f05` | feat: log cache reuse % on DONE line and COMBO attempt depth | inventory-only |
| 243 | #4642 | `85e9e31bbf6e87d1db81a64735e2b11cd8908ba7` | fix(translator): keep service_tier through the Anthropic->OpenAI pivot | inventory-only |
| 244 | #4641 | `1ced319a8bf8326129402ca36afd907fc26e6a83` | feat(systemone): add provider combos with fallback and round robin | inventory-only |
| 245 | #4636 | `3b5208248dce3109c4b6b76f6234d1d1392c0323` | fix(thinking): clamp native effort for GLM-5.3 passthrough | inventory-only |
| 246 | #4635 | `2d6cd760701a56078a5e7c17d7d89bde61a92f4b` | fix(pricing): price effort-annotated model ids at the base model rate | inventory-only |
| 247 | #4634 | `cbe67d5c0268c3c77e615f0d8043e05c1bf092c4` | fix(chatCore): propagate resolved stream decision when the client omits stream | inventory-only |
| 248 | #4633 | `21526e6c30ba9b6ae65c6da62fadff879a1100d6` | fix(executors): request include_usage on streaming openai-compatible calls | inventory-only |
| 249 | #4632 | `be2311307a7b227ac4e281c9a703562988ce5d21` | fix(translator): map response.incomplete to finish_reason length | inventory-only |
| 250 | #4628 | `900178f5e0cd73b3d0bfda695c2ad5bd140f891b` | perf(pricing): cache compiled glob regexes in matchPattern | inventory-only |
| 251 | #4627 | `7103585b3fa918766f1a018d3376248255d31ee2` | fix(models): filter inactive provider seats when computing combo limits | inventory-only |
| 252 | #4625 | `59724303cac440a24e7dbf1be54451c0beafb8d8` | feat: add scheduled account wakeups | inventory-only |
| 253 | #4621 | `94620c6bdeb17046ae12e39eb6037b55794c3c3b` | fix(copilot): route modern models directly to responses endpoint | inventory-only |
| 254 | #4619 | `a53049204659a0d0f4a8741d977bbade4d39ac43` | fix(models): publish codex catalog envelope on /v1/models | inventory-only |
| 255 | #4615 | `3f9d96f0264c54aab4e0f4498eb506699528219f` | fix(usage): show free provider topology nodes only after use | inventory-only |
| 256 | #4613 | `65b425d37e100240dfe9f397db5c0f032e3d43a7` | fix(codex): include requested reasoning level in request summary | inventory-only |
| 257 | #4612 | `d41355f573372e9814451e51685252c80b023def` | fix(kimi): convert Claude Code deferred MCP tools before dispatch | inventory-only |
| 258 | #4611 | `8545f67e9baa30c7e97d8d1d7542628e5fb890bf` | fix(muse): route Responses-only models to /responses | inventory-only |
| 259 | #4610 | `8519689ad0bfc56e661d3da35bfaac01c5778fee` | fix(responses): send reasoning.effort to Responses endpoints | inventory-only |
| 260 | #4607 | `8afabe06eb9f325ad232a33d65b24de0ecfaaed8` | fix(translator): preserve strict tool declarations | inventory-only |
| 261 | #4593 | `4317b4493bd31f5970444b7df25358682905548e` | fix(proxy): cool down and rotate no-auth proxy pools | inventory-only |
| 262 | #4586 | `a97fac1713e35e03079d3f24f30033c4ce5dc8a2` | fix(cloudflare): ensure outgoing messages have string content | inventory-only |
| 263 | #4585 | `c464dcf84970cf717b058fab4201b8197e813260` | fix(stream): forward Cline reasoning deltas | inventory-only |
| 264 | #4584 | `af66a56e578ce5da203f50766266170ef81c7d81` | fix(combo): normalize model identifiers at API boundary | inventory-only |
| 265 | #4583 | `646c757b8e77a19362baef3f6a6230e360dce4b3` | fix(usage): sort cost columns by displayed values | inventory-only |
| 266 | #4581 | `261aa39c4af5c4f623d295ed78ad67c41dc0ec10` | fix(translator): retain single-tool-call policy | inventory-only |
| 267 | #4579 | `71b73b492bb09199efdacc9ff56a5f5ff1881d93` | fix(chat): default omitted stream to JSON | inventory-only |
| 268 | #4578 | `a1250ee9eac67ada1bb8c473327e6788d5f6b91b` | fix(capabilities): publish Grok Build subscription limits | inventory-only |
| 269 | #4576 | `17990cfa32840d0c9f134009812bc0bb38272f7d` | fix(combo): persist explicit fallback strategy | inventory-only |
| 270 | #4565 | `439ace559c8e6f803f01080f05abb58fdf4d3007` | feat(cli): ACP agent for Zed + connect zed | inventory-only |
| 271 | #4564 | `279ad2c62f4495da6ff3307ff31b9ff844bd2ab4` | feat(tokenharbor): seed the current free-tier model ids | inventory-only |
| 272 | #4559 | `6352f737d9bf75cd0398591042628ff2b17f6811` | fix: stop sending unsigned thinking blocks to Antigravity | earlier-head-only + 1073-late-june-recovered-2-dispositions.md |
| 273 | #4551 | `dfd74f0b366a75302d618cccd70893b7c6b5c803` | fix(usage): keep Responses cached and reasoning token details | inventory-only |
| 274 | #4550 | `b069cd4b4061503cafaedda734d835f78a36f324` | fix(cursor): cover every ExecServerMessage variant in EXEC_RESULT_FIELD | inventory-only |
| 275 | #4547 | `813ec0dc074ae7d139ff927796c300ae2f1a4c30` | fix(responses): map Chat Completions response_format to text.format | inventory-only |
| 276 | #4546 | `a5d922577dd3647a5470848848d4379b57833395` | Add models for MiMo and Kiro MITM | inventory-only |
| 277 | #4545 | `d12242f30bf56da9903bd9bc004f306cd872941b` | fix(responses): clamp tool names to the real 64-char API limit | inventory-only |
| 278 | #4543 | `16156aabbabfbcfd5d9f6f8205247058158de9f4` | fix(codex): preserve explicit function tool strict modes | inventory-only |
| 279 | #4541 | `20dd4467c1e0055b8e7fa86b27ecf6cb82c42c7b` | feat(api-key policies): Add scoped provider and model routing | inventory-only |
| 280 | #4538 | `2ffd4c7be91da6fe48e7b6ac556ea7eaf2d6636f` | feat(auth): add model ACL access control and admin request logging | inventory-only |
| 281 | #4534 | `0c7d824708af5435e326fdeee6c8bc0d526d400c` | fix(streaming): default omitted stream requests to JSON | inventory-only |
| 282 | #4526 | `aab6c6c282acfe251f2e6ef7e58a72ba38810c25` | feat(usage): per-connection decode speed stats on quota cards | inventory-only |
| 283 | #4525 | `52e3a0ec7591d1992c8e9067eff9da0cda36f472` | feat(codex): per-connection force fast mode (priority tier) | inventory-only |
| 284 | #4524 | `71ec1d3e49171a6b07b442fe3741e6a59fe6b511` | fix(caps): codex gpt-6.1-sol contextWindow 872000 | inventory-only |
| 285 | #4522 | `9547f5b60bf301ae4b6fad1fa1369bf0e4463921` | fix(cli): attach server lifecycle events before entering tray mode | inventory-only |
| 286 | #4518 | `3034d9e64884061099cc7517c9f0366da007543e` | fix(responses): forward input_image tool outputs as image blocks, not stringified base64 | inventory-only |
| 287 | #4515 | `625d515a5d624adf2afa688dcf27babd39c4bb01` | feat(nvidia): refresh the NIM model list (7 chat models -> 33) | inventory-only |
| 288 | #4514 | `f374522564fdf4b8d6c35aedf1b41a747ced2e16` | feat(caps): capability patterns for qwen3.8* and longcat-2.5* | inventory-only |
| 289 | #4513 | `3bd5e9513409c44f929ef7b37b6c4d433630c16a` | fix(claude): echo client-requested model in message_start for routed streams | inventory-only |
| 290 | #4512 | `3486f964b0407e18c6410f4a721b7c10e73525e2` | feat(usage): expose Codex credit balance and Luna Reserve quota rows | inventory-only |
| 291 | #4511 | `68c18036a3a0e1b1bb7127e95e7f220a328eec28` | fix: Claude Code ↔ CodeBuddy/Antigravity state-machine fidelity | inventory-only |
| 292 | #4507 | `91f92f32fcea15789701dcf08ee24f581a54af9c` | feat(capabilities): add Gemini 4 Argon (gemini-4-argon) | inventory-only |
| 293 | #4506 | `24c8f0495a3cd196a787f18e416354f5cffa0a84` | feat: antislop UI filter in Token Saver | inventory-only |
| 294 | #4505 | `4016142114ae33839ed126a8a8213292850b5141` | Vedikemherbal patch 1 | inventory-only |
| 295 | #4492 | `91ec1fb444a089012d463b69fa36acce29523c9b` | fix(providers): test models with selected connection | inventory-only |
| 296 | #4490 | `dc46d78d7add1deeea28c9c51ce74f0462d8f35b` | fix(responses): sanitize tool names for OpenAI Responses and repair namespace aliases | inventory-only |
| 297 | #4486 | `29dc868b4cc2b17ba5f8bde6f97d21ffb975e149` | fix(gemini): close blocked and truncated Gemini streams with an explicit error | inventory-only |
| 298 | #4481 | `5b34730e60863c2709042ee6afc26b4b7719abf5` | fix(usage): keep Claude prompt-cache split in OpenAI-format usage (#2873) | inventory-only |
| 299 | #4479 | `75ec515efe35ee60ce38ffa35c958746ac47ac94` | build(cli): declare esbuild for the MITM bundle | inventory-only |
| 300 | #4477 | `e8ebc91b62f5bf6b2410d14ba3b54c3cc88488bd` | fix(translator): preserve in-band stream errors across formats | inventory-only |
| 301 | #4475 | `46ebf215fc1ec0098925a5cfd90794cc19c3f952` | feat(azure): opt into the Responses API per connection | inventory-only |
| 302 | #4474 | `c5f6afbb0e9a4376141c67bf2842a224eace5b0a` | fix(routing): route bare gpt-5.6-luna to Copilot | inventory-only |
| 303 | #4472 | `1d8981bf5661183af30655640f31d7103c5e61ab` | fix(responses): preserve Codex tools and stream integrity | inventory-only |
| 304 | #4468 | `6a0b979d4142cdc70c22a2da627d353a94e05182` | feat(providers): add Devin Cloud provider with native tool calling (supersedes #3460) | inventory-only |
| 305 | #4467 | `1349afe20ea3ef467592d8b3154c3d25172537a4` | feat(providers): add Cheaper Inference provider | inventory-only |
| 306 | #4457 | `bb69a3aeda0a6c8ad66ece3ff19b7f365e1e9e96` | fix(stream): keep reasoning chunks that arrive as delta.reasoning / delta.reasoning_details | inventory-only |
| 307 | #4442 | `d962deda0acf21dc5f7651c05408875ce0c635af` | fix(tools): coerce free-form property values and tuple items in tool schemas | inventory-only |
| 308 | #4439 | `9f1824198164ca7990ed4efa9ee24c12fc842688` | fix(fallback): rotate account on per-key credit exhaustion (400) | inventory-only |
| 309 | #4437 | `695903179ea63bd606e707ac45000224577d3ddb` | fix(stream): emit the [DONE] sentinel for OpenAI streaming clients | inventory-only |
| 310 | #4429 | `825aad427a62e2b3e623c483307032f1117811e2` | feat(providers): add NaN.Builders support | inventory-only |
| 311 | #4427 | `7438b888069b0a9f9ebb2ec28fba117462db2337` | fix: default to non-streaming response when stream unspecified | inventory-only |
| 312 | #4414 | `037767f10dadfa32eb649a3bdfe1312b9e397a8e` | feat(usage): group provider quota limits with responsive dialog and availability metrics | inventory-only |
| 313 | #4413 | `3e72a9792172e9dc624b1cb0eed6c61bcb94bf72` | fix(opencode): enforce min max_output_tokens >= 16 and prevent tool call collision | inventory-only |
| 314 | #4412 | `d47fd38a33f587a974937fcd37341c6c199d2186` | fix(handlers): sum usage parts when Gemini omits totalTokenCount | inventory-only |
| 315 | #4397 | `abf3276a1b80c5711b00b9ea2e870d778db2ac50` | fix(translator): pair each tool result with its own call, not a global id map | inventory-only |
| 316 | #4396 | `140f5404e9141521f0aafdf6f1d0114c6024bf09` | fix(translator): keep function-tool strict semantics on every Responses route | inventory-only |
| 317 | #4393 | `07e52874ef890b5ff3be48243150b6c992e555ec` | fix(errors): reduce 500/502/503/504 cooldown from 30s to 5s to survive fast-client retries | inventory-only |
| 318 | #4390 | `0a83415220ca1ff93db0dd6fc8acc2203e14256d` | fix(pi-settings): merge provider block and preserve contextWindow/maxTokens on save | inventory-only |
| 319 | #4389 | `fa4cecd14891cdd0b9f131439af82d82657ac591` | fix(db): preserve active modelLock_* entries when connection is marked active | inventory-only |
| 320 | #4387 | `9a7211deb3b6e2a90832bdc238ec488f7cf412bc` | fix(opencode): clamp max_output_tokens for muse-spark to [8000, 1M] to avoid empty completions | inventory-only |
| 321 | #4386 | `7e2187efa1b021cb8b5b668c9519ba46a417aac8` | fix(responses): emit custom_tool_call for type:custom tools instead of function_call | inventory-only |
| 322 | #4384 | `0bc6225f5751a9fb44872fcb0e5e772d50492812` | fix(updater): narrow process whitelist and use ps -eo to avoid SIGKILL of unrelated processes | inventory-only |
| 323 | #4383 | `6fe0f40c29868c1350e7f5594ccd63096a154746` | fix(translator): preserve message when content has unknown block types (container_upload) | inventory-only |
| 324 | #4381 | `a17e2afaa059c0c4cc3100a942bd03e586b29b5d` | fix(combo): fall through on model-scoped 400/410 and Codex SSE response.failed | inventory-only |
| 325 | #4376 | `08714d50679204d632bce7241759bc4da6391495` | fix(stream): forward SSE comment heartbeats in translate mode | inventory-only |
| 326 | #4374 | `3de3e6a82b0c7f955c7e0ff670fb26d22fd41055` | feat(updater): support automatic Docker updates | inventory-only |
| 327 | #4373 | `e511d6d3569c8984ce9589f0a1ec897723130382` | fix(codex): handle ChatGPT account model rejections in combo fallback | inventory-only |
| 328 | #4372 | `efd8cba593429a8e1f8faa5f58dc16a3670aa359` | fix(combo): filter unavailable members before routing | inventory-only |
| 329 | #4371 | `8994cfdcbf66b3d75f1aae51abd8fcde7bb08f7a` | fix(capabilities): delete globalThis slot on setCatalogSource(null) | inventory-only |
| 330 | #4366 | `5bd5f8884043c4a2aec258ff632c18f74b561c78` | feat(nvidia): add native NVIDIA models and stt service kind | inventory-only |
| 331 | #4363 | `e04431fb2a55983d6ac01cc0ce642fbf6b9a3281` | fix(usage): add codebuddy-intl case to parseQuotaData | inventory-only |
| 332 | #4349 | `4908743071d25ce027f6dfd580dc30c6faa1c4e2` | fix(translator): stop treating parameter names as JSON Schema keywords | inventory-only |
| 333 | #4348 | `7aafe589958f1618bc30b74abdb0bcefdbb40bec` | feat(gemini): park 429-exhausted API keys + orange on-hold badge | inventory-only |
| 334 | #4341 | `100abc111ae5736346b6568f05963d8c162b2866` | fix(capabilities): honour user-declared caps for custom models | inventory-only |
| 335 | #4340 | `1200df47b26eaa34722bf0850f851fecd257674f` | fix(combo): fall through to the next model on model-scoped 4xx | inventory-only |
| 336 | #4336 | `09c0a96ba30667c4b07209f8fc61e8d8ec8c14a7` | fix(stt): forward Deepgram diarization and map verbose_json segments (#3898) | inventory-only |
| 337 | #4332 | `5fefdd88cf781b30c5ea5ab58ba24d544409d7ef` | fix(stream): record mid-stream failures as error instead of success (#4104) | inventory-only |
| 338 | #4330 | `d94937f0c1030d7bba91aeecaae7138a6b798e2e` | fix(oauth): build the connect redirect_uri from the public base URL (#4054) | inventory-only |
| 339 | #4323 | `fb1ed7d57ff98d6502ccda37823b65c68ffa9c63` | fix: handle container upload messages | inventory-only |
| 340 | #4313 | `7ed9cd0abe56a79b6423df0b4966e7c929b046bc` | feat(codex): discover account models across catalogs | inventory-only |
| 341 | #4305 | `f407a259e1dd3a1975ea22783d36877cfad2c1fe` | fix(codex): clear cooldown after reset credit redemption | inventory-only |
| 342 | #4303 | `d05d03def843bb2249ad19c0a27f4a084387c0d5` | feat(proxy-pools): add proxy type selection in add/edit modal | inventory-only |
| 343 | #4298 | `d2419ff42902d9025102e4ceee4c064a17f9bacc` | fix(translator): normalize Gemini and Claude non-streaming responses for /v1/responses clients | inventory-only |
| 344 | #4294 | `9d165c7b0ccd21af5b5d8edacc2545edc8aa0eaa` | fix(cli): stop killing processes that are not ours (port occupant + stale-process sweep) | earlier-head-only + 1073-late-june-recovered-3-dispositions.md |
| 345 | #4292 | `c83b5d778de2eeefe9a53fba3632e16f6e86bf03` | fix(codex): use conservative account-scoped model catalogs | inventory-only |
| 346 | #4291 | `a84bbd932de406278715b17f5bfe5b8775cb4bca` | feat(details): requestDetails is stored with extremely high compression (over 97%) and the entire message body can be reviewed and viewed | inventory-only |
| 347 | #4290 | `82d964b3a6dff55b3f94808f966ff6cde3aac077` | build: commit package-lock.json and use npm ci in the Docker build | inventory-only |
| 348 | #4288 | `c905c54135bcd45fa17aee838fb742064d2cce73` | ci: add test, security scanning and dependency gates (CodeQL, Dependabot, SECURITY.md) | inventory-only |
| 349 | #4287 | `25017bd1f050632b13cfa235111269c5fa4024bc` | fix: preserve Pi provider metadata and model limits | inventory-only |
| 350 | #4286 | `ca3664c7b0d77cbe9373a1285024da2aaea4370f` | fix(security): reconcile remaining GHSA protections against current master | inventory-only |
| 351 | #4280 | `d767458753d1abb64d6d993673cccc118e5c9548` | fix(providers): persist account reorder correctly and resync on failure | inventory-only |
| 352 | #4278 | `3022684cd471224b652924d49709c912092db38c` | fix(pi): preserve model settings and resolve missing limits | inventory-only |
| 353 | #4274 | `7e41c54a4269910a343a2e6f49a1ed6d506b67d0` | fix(translator): disambiguate colliding tool call ids in openai to gemini request | earlier-head-only + 1072-nov22-verify-9e00.md |
| 354 | #4267 | `1172fcec1b99817d1116cf23033d14e1266f0ba5` | fix(providers): force streaming for cline/clinepass so non-stream clients get a bare body | inventory-only |
| 355 | #4256 | `2139deee26a6b44f7ea15879f682938f1e867b36` | feat(keys): per-API-key model access rules | inventory-only |
| 356 | #4241 | `05ca9ea54cd245091bdc9abd96faa0d1c6f211a7` | feat(keys): per-API-key limits and usage view | inventory-only |
| 357 | #4230 | `79e37c49807c35536db080101581ac7d516ec26a` | feat(combo): add Smart routing strategy via Jev complexity classifier | inventory-only |
| 358 | #4227 | `55445006f9c3c7c79eeb4826a574932d6ea743e0` | feat(providers): add OrcaRouter with API key and OAuth 2.0 PKCE | inventory-only |
| 359 | #4222 | `34c3f953c941aac0c2c4491c83bb556a3f97a1a4` | fix(responses): merge one assistant turn into a single chat message | inventory-only |
| 360 | #4208 | `957ef59bd316dcfa7aab63c8f3ed3169f6f93e50` | fix: coerce non-JSON tool call arguments before upstream dispatch | inventory-only |
| 361 | #4200 | `12ff0c0933134a57f60e970fba53141b4457d3e3` | fix(responses): translate provider-injected tool-call names to declared names | inventory-only |
| 362 | #4197 | `a4e379c11672f669000c41c95b354bd61d81086c` | fix: avoid breaker on content-triggered 429s | inventory-only |
| 363 | #4195 | `adfabba9d35a31950832f72196aa79de27873988` | fix: update Docker actions for Node 24 | inventory-only |
| 364 | #4185 | `cc184a037467e7bba4653023e3a466da198df383` | fix(proxy): preserve strict proxy enforcement | inventory-only |
| 365 | #4159 | `336e32737863fa9187f9afba2b0fb911ca63cc79` | fix(provider-test): resolve connection tests from the registry validateUrl | inventory-only |
| 366 | #4151 | `6a86eda2c42c633145e0453904ad32740a5f56c7` | feat(chatCore): Claude Code auto-permission classifier compat mode | inventory-only |
| 367 | #4148 | `79645231def159a5cece617e2b67588d34991a50` | feat(monitoring): monitor 9Router through a Telegram bot | inventory-only |
| 368 | #4147 | `f5582414f810906b33f46bc2d151d9628c77a205` | fix(errors): forward Retry-After and stop retrying terminal billing errors | inventory-only |
| 369 | #4146 | `7b56f1791ce3af94527bcd08fe33c89a278e61e3` | fix(opencode): ensure decoy tools for free-tier requests with custom tools | inventory-only |
| 370 | #4144 | `a725383c638c0102a810419eba1004fe4418ce4d` | feat(auth): add TOTP two-factor authentication for dashboard login | inventory-only |
| 371 | #4134 | `c9261c76713b0b5b713a5ae9b942e4870cc0660d` | sync  | inventory-only |
| 372 | #4128 | `a27f3e7bbae0b43b62e6e529ab314a939d65a1d6` | fix(opencode): restore free-tier client identity | inventory-only |
| 373 | #4110 | `c068f5cf9b4b08c15015424aeab82dbe7a2446c8` | fix(translator): preserve function-tool strict across Claude and Chat routes | inventory-only |
| 374 | #4089 | `1fd8db8573e1cee146df22b2497915393c9cdae5` | feat(providers): add ainetcafe (Kimi K3) provider | inventory-only |
| 375 | #4087 | `fa52f3f0cdd42d13953aae4f665056f7a0f65a5b` | fix(video): isolate poll cooldowns and enforce pinned accounts | inventory-only |
| 376 | #4078 | `6b0d47fff908b459616f6f5f1e65ccefa0fae237` | feat(routing): "cache-affinity" account strategy — one conversation, one account | inventory-only |
| 377 | #4074 | `5a2009e4c186341750e6c4024b67d753c96dbffb` | Preserve and normalize usage.cost.total on chat completions | inventory-only |
| 378 | #4071 | `5f4fd5bcbd709e21923ccf1900c2c0aaf7170d43` | feat(observability): allow opt-in request payload display | inventory-only |
| 379 | #4068 | `6085e9ead65c0d07afce3cd2a1bc2935f1d0504a` | fix(pricing): align provider token costs | inventory-only |
| 380 | #4067 | `68d713028729ff1574eaeac16a2253a85a41a65d` | feat(github): support Copilot auto model selection | inventory-only |
| 381 | #4066 | `708536e18a3bd621f2a9e98ddf74d7f36257f53e` | feat(codex): add generic per-account fast mode | inventory-only |
| 382 | #4064 | `abe1c1d1f0df9bc7192fc9387b31a6022f598b2b` | fix(capabilities): stop the o-series globs from capturing Cline's Solar Pro 4 | inventory-only |
| 383 | #4063 | `2c7e145c74ec611526a9a3e50a32ca3bc68acd57` | fix(translator): stop emitting literal <think> tags on Claude → OpenAI | inventory-only |
| 384 | #4058 | `acfc6618a1fb4b18e931ba369d49ba2f8e8d7bff` | fix(translator): keep Responses tool-output images as images | inventory-only |
| 385 | #4056 | `0c0c31a1be6370b289cb52680170f78249a73bba` | fix(rtk): skip ponytail injection on media-carrying requests (vision degradation) | inventory-only |
| 386 | #4051 | `961fc404b0ca0c47f448098525e5934dfc3c5a33` | fix: record Codex Responses usage after terminal event | inventory-only |
| 387 | #4048 | `bfb914bb7ccae4b243bc75b080b6cb1f54ea252c` | fix(capabilities): OpenAI reasoning models cannot disable thinking | inventory-only |
| 388 | #4047 | `81ee745c1ae0edd4f45dbaa9b71a097422869a19` | fix(google-pse): configure and validate search engine IDs | inventory-only |
| 389 | #4046 | `3a39a33115c6ebc98188b0fa9f103663584118c4` | fix(cli): persist model IDs when creating TUI combos | inventory-only |
| 390 | #4042 | `35efdef74f8918a2c0d3bfdaacf35142c0cd264a` | feat(usage): add All Time period to usage stats and chart | inventory-only |
| 391 | #4041 | `8cbf3eb1641b0ecbef1e9a7baf6b4010b65ed7d6` | feat(github): track AI Credits and enforce a local per-connection cutoff | earlier-head-only + 1073-late-june-recovered-2-dispositions.md |
| 392 | #4030 | `8f9ba10883b12759125797894e26ddf07da4eeed` | fix(dashboard): surface why a provider connection test failed | inventory-only |
| 393 | #4029 | `bc321928f92fbab20f0ee4f1cb96d90be6f0522a` | feat(claude): store account email and real plan on OAuth connect | inventory-only |
| 394 | #4027 | `bea426e85c231b43080d4cc496940092f6fcf8df` | fix(dashboard): reset credential modals on close so reopened forms start empty | inventory-only |
| 395 | #4025 | `ec37080a5cee388056cb79f66de3dd6aafb3ffd2` | feat(commandcode): record prompt-cache reads and add quota/usage tracking | inventory-only |
| 396 | #4014 | `d9014f21a50ce770058f6b6f7b4eb41acbcc3010` | fix(mitm): guarantee hosts cleanup on shutdown/crash and guard tool DNS restore | inventory-only |
| 397 | #4004 | `b1b6362c7b6b3c499053bfb11219ca14e6610f58` | fix(commandcode): forward images instead of "[image omitted]" | inventory-only |
| 398 | #4002 | `6ad36f84cc907d551a3ed53eaf205b0956b97ecf` | fix(stream): stop blocking an Ollama upstream's NDJSON as a non-SSE body | inventory-only |
| 399 | #3999 | `010411dac894c08e11f9a683db2c440de5341753` | fix(gemini): expand shorthand string subschemas in tool declarations | inventory-only |
| 400 | #3997 | `ac8021e13a755ed3898fa4fe5a3680991bf7a55d` | fix(oauth): parse numeric epoch expiresAt so imported connections still refresh | inventory-only |
| 401 | #3995 | `06efc0606ea4039260847d946388b8747270e19c` | fix(deepseek): register the renamed deepseek-flash id and scope adapter pools | inventory-only |
| 402 | #3987 | `aec5a15249ba381a5b89aafec4d0f2ed523bd36e` | fix(antigravity): normalize OMP harness instructions before upstream requests | inventory-only |
| 403 | #3983 | `0733a570c5ac91f616a719fc9fce4e3ecb578a3a` | feat(caveman): support per-combo cavemanEnabled and cavemanLevel overrides | inventory-only |
| 404 | #3975 | `0ba2ebc32c8ede2d4d35dee41903588f165c7aec` | fix(opencode-go): route gpt-5.6-luna and grok-4.6 to Responses endpoint | inventory-only |
| 405 | #3973 | `2dbdb42c646953148c64d0e42eac0c38b2d2b169` | fix(gemini): keep every system message in systemInstruction | inventory-only |
| 406 | #3971 | `753bc8fe432bcf21a151afc939812d83a41564c3` | Feat/codebuddy credits checkin | inventory-only |
| 407 | #3969 | `219c9e94123474cebae4a9f172a582baef92a321` | feat(antigravity): persistent quota locks & family-based routing | inventory-only |
| 408 | #3968 | `10dd836abfc24fc7436ce37ffd6550bffc7a7d91` | fix(translator): support IMAGE and DOCUMENT blocks for Antigravity Claude envelope | inventory-only |
| 409 | #3967 | `8a6c3ebac48954d93490c6779568c8538330b8de` | feat(cline): add free-tier models and API-key auth | inventory-only |
| 410 | #3966 | `313e5ab1eae2bbabcf1d8253d0282335e96dde5e` | feat(video): proxy finished video downloads (GET /v1/videos/{id}/content) | inventory-only |
| 411 | #3965 | `6730488461b0014004485ce2f9c82ffb9a30461b` | fix(video): resolve poll provider from self-identifying job ids | inventory-only |
| 412 | #3964 | `ff9f9bbf1a168c06dab331590e2fa7d58757b5e6` | fix(vertex): use Vertex GA Veo model ids, not Gemini API preview names | inventory-only |
| 413 | #3960 | `d2d795aadf70197f073e8993518f6861dfd50ae3` | feat(providers): add Token Market | inventory-only |
| 414 | #3958 | `ad67e39e005903f726c3f6b8b43fdc7d475da926` | feat(privacy): Privacy & DLP module — rename, consent_log, duplicate-key + icon fixes | inventory-only |
| 415 | #3945 | `085125befa45733781f63e47849b7ed76eaeb6ea` | Contribution by Serenhope | earlier-head-only + 1072-nov22-deferred-09.md |
| 416 | #3936 | `614286783b7cc4c7411ac4405405dcd4d0e65581` | fix(claude): repair trailing assistant prefill instead of dropping it (#2302) | inventory-only |
| 417 | #3914 | `4ef39ef8020f51f525ecc6b3f9c6a9da6a83b5e8` | fix(usage): make overview cards update in real-time via SSE | inventory-only |
| 418 | #3913 | `c8db1f558922e589732cbf92bd0625c2f0a9e3fd` | fix(usage): keep the client context buffer out of the recorded turn | inventory-only |
| 419 | #3911 | `cdc04504b73fc013b30e604573d6f320dedde67b` | fix(endpoint): slow the health polls down instead of stopping them | inventory-only |
| 420 | #3910 | `9a49c070086075696f5ee0c20d40ae15987d8f8a` | fix(dashboard): count down to a lock that has not expired | inventory-only |
| 421 | #3909 | `9d0eb56816f5fda7d352a8a402bf4d1c740e56d6` | feat(models): declare capabilities on combo entries in /v1/models (#3901) | inventory-only |
| 422 | #3908 | `e9a459ebece0f8cd7980a76938766510e2499b94` | support TZ env | inventory-only |
| 423 | #3907 | `42e8740e7595b30174cf555b85a81596f0222e12` | fix(stream): record the turn when a client hangs up mid-stream (#3488) | inventory-only |
| 424 | #3896 | `9c1fa0d2ce1cb4ae343da9b6c473cf48574003ee` | fix(models): honor model selection for compatible providers | inventory-only |
| 425 | #3894 | `eb77571193ca594e147c1ddf63758fdce174e7d8` | fix(errors): request-scoped schema 400s no longer lock accounts | inventory-only |
| 426 | #3887 | `341948e2b506de31e145d735d8eedd41d34ff552` | feat(opencode): route claude-format models over /v1/messages to keep prompt caching | inventory-only |
| 427 | #3885 | `188ff2963a66886d7a96f793f18466582f4cc97d` | fix(claude): drop Claude Code `diagnostics` body field rejected by Anthropic | inventory-only |
| 428 | #3879 | `b75fcdd9737bab50621a153dacab07b849953422` | fix(stream): expired model lock masks account lock, and dropped generated images (#3516, #3521) | inventory-only |
| 429 | #3878 | `36d4cf186d725634d1786ae5434876b39d244be6` | fix(translator): six format-conversion defects (#3243, #3247, #3254, #3369, #3492, replaces 6 PRs) | inventory-only |
| 430 | #3871 | `309f6842d618fb5f3c772620779717bafdd841d1` | fix(reliability): prevent 400 client error account lockouts, handle Codex compaction on Gemini, and fix console scroll | inventory-only |
| 431 | #3870 | `1137fefc113c51ae68ba67de0a2f1d984d4b8702` | fix(codex): align client identity, scope model failures and validate streams | inventory-only |
| 432 | #3869 | `b1107b86ff35495c7c7aa3bfeca732b611898ca6` | feat(providers): add Baseten Model APIs support | inventory-only |
| 433 | #3867 | `09be12e30be92e560b1fe3ba619b8c9cb20d8072` | fix(responses): preserve images in tool results | inventory-only |
| 434 | #3866 | `0a5306b43f832265205b72c3ac3fc2acb44a08b2` | perf(models): cache /v1/models with stale-while-revalidate to fix CLI startup timeouts | inventory-only |
| 435 | #3863 | `d6c08f76276eb0113c73b867f3a46b6d55a26b76` | fix(combos): preserve visibility for strategy combos and improve runtime CLI defaults | inventory-only |
| 436 | #3862 | `05a3ee02f4cd47aa8d24e709f64f519ed0087f40` | fix(db): prevent silent database wipe on SQLite corruption and add startup quick_check | inventory-only |
| 437 | #3860 | `cdc4741162707741e91a2aff55060ac176671be6` | fix(stream): harden Anthropic SSE success boundary + scoped fallback | inventory-only |
| 438 | #3859 | `16c1b9587f6b3542f131710c106940cdfbc8d6b3` | feat(providers): add DaoXE as an OpenAI-compatible gateway | inventory-only |
| 439 | #3858 | `cb18678782980951a47169008464f80917661715` | feat(models): preserve custom model token limits end to end | inventory-only |
| 440 | #3857 | `7d198d3f8a5c954109a49619dbe762114be3a490` | fix(gitbook): restore useEffect import and drop the orphaned mounted effect | inventory-only |
| 441 | #3852 | `b4f2e37d6a6af143fc3ae01d668fed664509bebd` | fix(dashboard): support managed production model tests | inventory-only |
| 442 | #3849 | `d70b1945211980c4d0b0a000df333347f20c71ee` | feat(opencode-go): identify with coding agent User-Agent | inventory-only |
| 443 | #3843 | `1cf88cc8e34bef162eb7f0f46192ab3bee43d9e3` | fix(nonstream): Responses-API upstreams for Claude/non-streaming clients | inventory-only |
| 444 | #3842 | `2951b66518119f077465c03802fc7e2ca3b7f1b6` | feat(responses): add native capability probe and routing gating | inventory-only |
| 445 | #3837 | `5c484cb06098fe54cdac3995ce862c4666abc895` | feat(kiro): calibrate cache estimates from native credits | inventory-only |
| 446 | #3835 | `80b21f80dd2e1fccf485d9640c5554e3bb1f04f3` | fix(usage): record token usage for /v1/responses streams | inventory-only |
| 447 | #3827 | `f8d45a792d1530d0d620d9601d446873d3de57de` | fix(claude): pass xhigh effort through on models with native support | inventory-only |
| 448 | #3826 | `41e03107cd52f90affbc35f021688a86b9bcda17` | fix(claude): decloak tool names on every claude→claude response path | inventory-only |
| 449 | #3823 | `986d826f94275cddbef54c2a27f28757f43dcd03` | fix(open-sse/codebuddy-cn): stop stripping legitimate agent system prompts over 2000 chars | inventory-only |
| 450 | #3822 | `243561251f65a678457f100fa5218ed73c6b2e48` | fix(db): fail closed before migrating corrupted databases | inventory-only |
| 451 | #3805 | `0caebb822ddd989bf7141e48408fad1298470c38` | ci(testing): add vitest unit test runner + CI | inventory-only |
| 452 | #3793 | `2099b4efd144bfa4148aa1c5b491cbf31a1d8a23` | fix(search): allow configured private endpoints | inventory-only |
| 453 | #3781 | `11da4762eea2d5c5449390b4b759f5f469c752d7` | fix(claude): convert non-streaming responses to Claude message format and add SSE ping heartbeat | inventory-only |
| 454 | #3773 | `bdfd67e44afb2856df7bf5c6e8e8e56f795be31f` | feat(api-keys): model/provider scoping for API keys | inventory-only |
| 455 | #3772 | `e3d41349388e8bc498675fe9ebeba3b55552c8ea` | fix(translator): placeholder for binary tool_result blobs instead of raw base64 dump | inventory-only |
| 456 | #3771 | `d747b3c8aeb964670923b49d8216da49248161e7` | fix(errors): preserve the upstream status class instead of flattening it to 503 | inventory-only |
| 457 | #3770 | `8e011fd7fca1e75dd1ec5437a3bf187227f48092` | fix(errors): stop reporting an unconfigured provider as a missing model | inventory-only |
| 458 | #3768 | `161562214229a236d08a469c7671da109ce08d04` | feat: replace Gemini 3.5 Flash with 3.7 Flash and add combo weights/config support | inventory-only |
| 459 | #3754 | `9c3821522af781ec77b499ed6c00952da9bf34fe` | feat(combo): configure context and input capabilities | inventory-only |
| 460 | #3748 | `d9ac12e271aacd30a640ac871ec12893bd81db33` | feat: add connection groups, search, per-combo allow-list, usage-by-c… | inventory-only |
| 461 | #3746 | `4a5d0a139b1012e4e8a64055d4804d9b96ae7d02` | Handle unsupported thinking fields in Kiro requests and tests | inventory-only |
| 462 | #3745 | `f7dc00c48dd7551bce20c61dd1fbb17ed6eeca1a` | fix: suppress SOCKS5 ExperimentalWarning and downgrade ProxyFetch fallback to debug (fixes #3744) | inventory-only |
| 463 | #3713 | `4f57d729bf8bc08080871ffa4700847cdbe3e28d` | fix(antigravity): clean empty parts and merge adjacent turns to prevent 400 INVALID_ARGUMENT | inventory-only |
| 464 | #3705 | `053e5eb39b2115fa359bdeda7610e4754c12d167` | test(combo): add coverage for account-selection fallback loop | inventory-only |
| 465 | #3703 | `5ad52923c1a11df4efab9e731e231dcd84a09d2d` | fix(providers): support config-driven re-tests and reduce quota polling to 5m | inventory-only |
| 466 | #3693 | `38866b5667dd7142201eb18797449c00f6a1ac57` | Echo the requested model in Claude-format streaming responses | inventory-only |
| 467 | #3689 | `3c1b3c9a0bc45d29c78b6a60ea9a1a00e06f245b` | fix(security): redact request logs and trust server correlation IDs | inventory-only |
| 468 | #3683 | `453a7de951e1f24cbce7b95cace2108c4a8deda2` | fix(chatCore): return an Anthropic Message on the forced-SSE JSON path | inventory-only |
| 469 | #3665 | `3792d0facaff6dab3cb8fc410bbc41a9a5a28353` | fix(tools): normalize provider-incompatible function schemas for fallback routing | inventory-only |
| 470 | #3664 | `4dcd72599b56dd1bc6bb08b99c3b11839c37fabe` | fix(codex): support Spark constraints and 128K context | inventory-only |
| 471 | #3654 | `a334e4dc67b90904900475b5af9555606c76d244` | feat: add selective provider and combo transfer | inventory-only |
| 472 | #3652 | `cc19c1ad35291dd5359f00f77bfdd7959349e114` | fix(rtk): treat a Responses input item with no type as a message | inventory-only |
| 473 | #3645 | `b172570bd4423e9af67a3779281b4020febc8838` | fix(antigravity): preserve Gemini thought signatures across tool-call turns | inventory-only |
| 474 | #3639 | `053737fd060baab672b47d62cf1296fab2d34c0c` | fix(codex): use manual callback on hosted dashboards | inventory-only |
| 475 | #3638 | `e11b9a07914e60dddd873546e09d1cde73dd6696` | fix(model-test): allow internal auth without API keys | inventory-only |
| 476 | #3637 | `869972d8703fd5e2754fd2c4aeb049acba7a8c81` | Fix: implement tool name compression to handle length limits in tool… | inventory-only |
| 477 | #3635 | `3f75dac1e4d67664955eeff4b189a37d374929c9` | Adding a link to verify antigravity account | inventory-only |
| 478 | #3632 | `b437655ffee97546bb0ab5b5d429978221013f12` | feat(routing): global + per-provider connect-timeout setting | inventory-only |
| 479 | #3629 | `710d67f51ddd2ae8d80cb0751a328710d2d2a86a` | perf: optimize concurrency, L1 db caching, streaming allocations and socket handling | inventory-only |
| 480 | #3618 | `15b80b8eff6e3910b685198cad189d8479f21236` | Add GLM-5.3-Flash and DeepSeek V4 Vision patterns | inventory-only |
| 481 | #3614 | `18e4bcc3db1128e98a64cd5748c1cf730943c37a` | Merge GLM ZCode OAuth support from PR #1848 | inventory-only |
| 482 | #3612 | `df279f00ce5522306967a3ff168f39ff7fe160ab` | fix(fallback): honor provider-reported rate-limit reset times | inventory-only |
| 483 | #3611 | `36d14d820e0758ea8b63560b43c3fa1b18859dcf` | fix(stream): preserve reasoning, usage and terminal events in passthrough | inventory-only |
| 484 | #3610 | `f9b271d8d3192a78cac4b2b848bc81942e85b3e6` | feat(kiro): update model definitions and CLI tool mappings | inventory-only |
| 485 | #3608 | `63903b5eecdd6ffca0153fe449d61ae7d43790c4` | Add error message for preventing abuse | inventory-only |
| 486 | #3604 | `bab2420763b00ba133c2d02f31e2e5d16f3adceb` | feat: New Models Discovery for all connected providers | inventory-only |
| 487 | #3601 | `87c4aa79883fc93563e186b27a5e309f6a6cc368` | fix(stream): keep delta.reasoning chunks in streaming passthrough | inventory-only |
| 488 | #3599 | `0a2ca03d76aa33ee8a2c64c3f88b573ca7880ae8` | feat(memory): modular AI memory management and context optimization pipeline | inventory-only |
| 489 | #3595 | `5ba0f0b3db60394f2e777eef466b1325fd347654` | feat: claude-compat layer, model-context & statistics dashboard rework, ops tooling | inventory-only |
| 490 | #3582 | `013728010893daec0c2cf500cd546574b8eb9011` | docs: add 2 Vietnamese video guides by ptit9x | inventory-only |
| 491 | #3575 | `7202bd6453a9d7c4ed34db37107c8f3538d65b2b` | feat(tool-disclosure): progressive tool disclosure — static filter + BM25 session index | inventory-only |
| 492 | #3560 | `e526cc5e94cacb4609dd070ff9a91bcc95bdf73f` | fix(combo): fail over on empty-but-successful streams (#3463) | inventory-only |
| 493 | #3556 | `ee0c9077fa1021c95cdee8f9501e23947fc1d704` | fix(stream): add TTFT watchdog to prevent hangs when upstream stalls before first byte | inventory-only |
| 494 | #3552 | `5fc3afef9b48e507487e5d3aab89c21524085aae` | fix(providers): give every connection probe a deadline | inventory-only |
| 495 | #3550 | `b90f5ae0d5ff1e60fcd4f88e8eb327c624c8d648` | fix(session): evict the least-recently-used session, not the first one stored | inventory-only |
| 496 | #3548 | `d0840b97b67cc74ef407571e64e97d068f69b609` | fix(tests): stop the headroom mock from breaking when an export is added | inventory-only |
| 497 | #3547 | `86d7fbfa5288df372abf4ee418d1d5c45d59e984` | fix(responses): keep one decoder for the stream and drain the last event | inventory-only |
| 498 | #3544 | `36aa66a83d35ff0ec99c4d5fd3effbdf83caccd2` | fix(usage): stop dropping requests that share a millisecond | inventory-only |
| 499 | #3543 | `cde39d815002ba10a94e9676b6af2ba123416559` | fix(oauth): stop leaking the callback server and its poll timer on failure | inventory-only |
| 500 | #3540 | `9805bed86ba11e78d166466226349e8847e3ac21` | fix(grok-cli): forward reasoning.effort for grok-4.6 (#3514) | inventory-only |
| 501 | #3534 | `a8ed492f28e4692eaed6022598bd525633baedb6` | fix(headroom): use execFileSync to avoid shell string with spaces | inventory-only |
| 502 | #3530 | `476930a65ef83ae348d72b3ca4333d1e3ce5bd0f` | test(golden): stop the url/header golden from pinning the machine that recorded it | inventory-only |
| 503 | #3527 | `c52fe95f53f1ab0f5ee1cf782ac3c343ab88a1ff` | fix(mcp): release the bridge session when an SSE client disconnects | inventory-only |
| 504 | #3526 | `1fb2b8ac418a552a068e987a5ae46eb68af39c5c` | fix(usage): release the stats listeners when a dashboard tab disconnects | inventory-only |
| 505 | #3524 | `e203891ce9b76303d4d4c292cab6eb90d049b3e3` | fix(codex-settings): refuse to overwrite a config that could not be read | inventory-only |
| 506 | #3523 | `9765faf557314343a7f30e7541446dc92fac9847` | fix(db): publish the sql.js database atomically | inventory-only |
| 507 | #3522 | `8d132bb340e9ffde1bc8312292cbaf0183746dab` | fix(tunnel): draw the public subdomain from a CSPRNG | inventory-only |
| 508 | #3519 | `47c7d6819b4d574981895fe2139dcde92b8715db` | fix(tunnel): accept either URL as proof the tunnel is up | inventory-only |
| 509 | #3518 | `4477ac5ebfdd42d24c466e13475d3e263989cc99` | fix(auth): keep the real reason instead of the bare "Provider error" | inventory-only |
| 510 | #3517 | `ee678d8d98d8962ed7d27664fb276ca005fb2af7` | fix(proxy): never send loopback requests through the outbound proxy | inventory-only |
| 511 | #3515 | `c5dd7d6b5c447539c86b0411f2ec21274d30d80e` | fix(usage): make the observability env vars actually reach the enable check | inventory-only |
| 512 | #3513 | `bcc2567334d394cc1cbfaab44202231e1e0a0bcb` | fix(usage): record streaming requests that end before their flush | inventory-only |
| 513 | #3506 | `e5945bc1327be09758795baf220677a2de456228` | fix(claude): normalize trailing assistant prefill for Claude targets | inventory-only |
| 514 | #3504 | `fe41dec326cd72e6c642e845386fda22b299c700` | fix(opencode): forward reasoning_effort for OpenCode zen stealth models | inventory-only |
| 515 | #3495 | `76561d0faffc3e23a2da13271d4323fdc7d416bf` | fix(sse): keep Responses reasoning as Claude thinking on the forced-stream JSON path | inventory-only |
| 516 | #3487 | `b61a8c4ce4cbda1a7eddea6c3d8c3bae2e8d6847` | fix(models): expose combo aggregate token limits on /v1/models | inventory-only |
| 517 | #3481 | `55da3e51741089c26cc9505cd43532a521ef0be1` | fix(usage): preserve cache/reasoning breakdown, stop reasoning double-billing, refresh OpenAI/GPT prices | inventory-only |
| 518 | #3478 | `991d034e53660d455c168db498be755ba58546ea` | fix(translator): correctly route Claude thinking to Ollama `think` param | inventory-only |
| 519 | #3471 | `7f5ff5ac80b34a03346980cdf2834ec5cd999bd3` | feat(quota): persist account and provider filter preferences in localStorage | inventory-only |
| 520 | #3465 | `83de6ccfd6250e539d33453dcef82bad2d30679e` | fix(stream): fallback to next combo account on empty/null content responses | inventory-only |
| 521 | #3460 | `28dcb5bebea187be2909bf4df149459efdbe6c31` | feat: add Devin Cloud provider | inventory-only |
| 522 | #3457 | `79a95263469e66f02f622dcb175acf0137d13f98` | feat(stream): emit SSE keepalive ping during upstream silence for Claude Code (#3409) | inventory-only |
| 523 | #3453 | `d8f678f901643b1d2c5d35d4ddbe495cd4248bb5` | Fly deploy | inventory-only |
| 524 | #3433 | `b4beb7c11b23d588becb069151bb1ebd787f6d56` | fix(responses): preserve usage in completed events | inventory-only |
| 525 | #3429 | `d520beb2e26f8b84d7919ac51da56e84797d4c1a` | feat(models): add combo-only model exposure | inventory-only |
| 526 | #3426 | `87e2a9c8d5a4a8bdc494eacef686d364ccf8aa79` | fix(usage): show model and provider for single-item groups | inventory-only |
| 527 | #3423 | `fdc06837b9e25ce8dfe393f709c8a081834727b0` | feat(open-sse): Revise Qwen3.8 pricing and add Meta Muse patterns and capabilities | inventory-only |
| 528 | #3411 | `3498deb80531b387b2ec990458ee3d4dc0c8a647` | fix(gemini): sanitize schema keywords in function responses to prevent 400 | inventory-only |
| 529 | #3408 | `17c9805259f3605dea80022aa7a6f71424548abd` | fix(commandcode): strip thinking suffix from params.model | inventory-only |
| 530 | #3394 | `a569328b3cf42967eb9dadab55b214ade0f770c1` | feat(open-sse): parse RetryInfo, ErrorInfo, and resetsAtMs delay from… | inventory-only |
| 531 | #3388 | `dc1d8e2e06cad9ec3a2dac3fdc81bdcbab3b48a0` | fix(usage): update dashboard stats in real time | inventory-only |
| 532 | #3387 | `680d458ba8aaf2b4424b26abe7081e2223a3e711` | fix(clinepass): unwrap { data, success } envelope in non-streaming responses | inventory-only |
| 533 | #3386 | `07acd42bacffe421028ae1437fd8cf06fe10c982` | fix(codex): surface SSE context overflow as 413 | inventory-only |
| 534 | #3381 | `81ef1377aaa8abe2e0d63b9dcedabbb9abc750bc` | fix(db): create credential store with owner-only permissions | inventory-only |
| 535 | #3373 | `7b3d59c7fbc9fb319ff0b2549ea3d0c68ac96484` | fix(responses): normalize custom tool names in non-streaming conversion | inventory-only |
| 536 | #3366 | `829f2a88ea2069d2455ef0004bf29e70e793b3c8` | fix(antigravity): drop messages whose parts become empty after thought filtering | inventory-only |
| 537 | #3363 | `b08f006324ebc5e355a871fb46f8f5bd34f1acce` | feat(providers): add Nous Research support | inventory-only |
| 538 | #3361 | `dae1a6cd0a41cce658f257b3a59bfebeb93a0942` | fix(codex): preserve typed Responses system prompts | inventory-only |
| 539 | #3357 | `a4f29f4577062d0e2fdec7dc4d7e322b13aa56e9` | fix(codebuddy-intl): preserve caller system prompts | inventory-only |
| 540 | #3352 | `dd6ba369abe76ec1d16aace5d0edf7406d0bef7f` | feat(backoff): make 429 cooldown schedule configurable | inventory-only |
| 541 | #3350 | `1f45c0e7b29bede1693ca0df613da957d67826bf` | Fix/kiro reasoning text content fields | inventory-only |
| 542 | #3349 | `c15cb97012c5edd06e093b10538a1718571b80d5` | docs(i18n): sync Indonesian README with English source | inventory-only |
| 543 | #3348 | `f2689edda9687201016cb57a8be1f496972a58c5` | fix(stream): recover partial usage when a client disconnects before completion | inventory-only |
| 544 | #3342 | `b6297f34cdd92f619cadf187f74024f446525efd` | fix(codebuddy-cn): make the system-prompt length gate tunable and loud | inventory-only |
| 545 | #3331 | `6396bc7a7f5a7474a5b585e100476c147c575c90` | fix(auth): disable Qoder connection on quota exhaustion (403/code 112) | inventory-only |
| 546 | #3329 | `7ef5d0f81e70fe9f5f625a1722a118b23f5fe26f` | w | inventory-only |
| 547 | #3325 | `7da8a079165dd0fe362056a214d2196942ff1ed0` | Adaptive unsupported parameter stripper | inventory-only |
| 548 | #3321 | `99e1762fa366da28ed6029d5e836724fbed7fd65` | fix(opencode): stop zen free-tier 429 — official client fingerprint + manual egress switch | earlier-head-only + 1073-late-june-recovered-3-dispositions.md |
| 549 | #3319 | `0cfc365641013175f8950b6f22084b3343fbb135` | fix(claude): hỗ trợ Auto Mode khi dùng model Codex | inventory-only |
| 550 | #3317 | `f32f9508a7cbf2e67fecad1476183dea5ad6c144` | feat(cli-tools): add OpenClaude support | inventory-only |
| 551 | #3316 | `413dd48ee757f38636116b3df14651260cc44b5c` | feat(codex): hiển thị service tier thực tế trong log | inventory-only |
| 552 | #3314 | `5a2adae730154aa829971f3ee839874512918dd4` | fix(cli): ngăn cài SQLite native khi khởi động | inventory-only |
| 553 | #3313 | `d5277737de24aba6a297d0c0d4fdda41cd71f535` | fix(security): chặn SSRF khi kiểm tra provider node | inventory-only |
| 554 | #3311 | `b25e2f45b6361ddb9e10a830a3a93f0f40d71d7f` | Sửa Test Connection Xiaomi Token Plan theo vùng | inventory-only |
| 555 | #3310 | `b9e13a07f2768765848aaf0cbe42f0b26540548d` | Sửa đối số tool call và khả năng Xiaomi Token Plan | inventory-only |
| 556 | #3301 | `7ee997f6623782dabae6508acea9324996e72904` | fix(chat): send JSON content-type when client omits the stream field | inventory-only |
| 557 | #3284 | `86f72462553097d758b455e6c8b762bb17bacbb7` | feat(cowork): add Lians memory plugin | inventory-only |
| 558 | #3259 | `39d8bbf9f50ec329f482442be167a8be465dc2a2` | update | inventory-only |
| 559 | #3258 | `e15b867cbe797b41629c7c27b5333fbb633ea88c` | feat(video): add MiniMax text-to-video generation | inventory-only |
| 560 | #3250 | `78b935d89ca13fbe49f728f5b7531d08d06860d5` | feat(opencode-go): read the plan usage endpoint, and stop calling a spent key invalid | inventory-only |
| 561 | #3231 | `e4ee0a4c2d9f916ea903488e239f786fb9dc214f` | feat: Add fallback cmodel (Cantus) for Qoder provider | inventory-only |
| 562 | #3222 | `daf1d9a1e50a77de6f56111198ad8205ca35cf81` | fix(stream): synthesize a terminal when upstream drops mid-response | inventory-only |
| 563 | #3220 | `51c0ce4b73baf4e32031a7ee8634267ff898dc2e` | fix(chatCore): bound non-streaming body reads, return 504 on stall | inventory-only |
| 564 | #3219 | `7e6b2b4336b14303c2ef5a3561536285c289529e` | fix(auth): stop truncating upstream error text mid-reason | inventory-only |
| 565 | #3217 | `0508e7738397355e5b9c9e25d7b480d458da77c4` | fix(translator): preserve Responses prompt cache key | inventory-only |
| 566 | #3213 | `2e6c8ad3c04cbc4bd9e8fc5b685ddd1586d0eb77` | fix(auto-ping): select Codex model from live catalog | inventory-only |
| 567 | #3210 | `daf469591997970a32cc678801246ffeb3411e5b` | feat(dashboard): show effective Codex plan badges | inventory-only |
| 568 | #3208 | `13f3ea39ddf601ec343a74f1d12197e58b8c3277` | Fix resolve 429 resource exhausted by switching to production api endpoint and optimizing request size | inventory-only |
| 569 | #3206 | `f3ab6f4d09f0b2d1cc531276dbd274d0f8843954` | feat(server): optional API-only port | inventory-only |
| 570 | #3205 | `f224d658ca4762ec3638481ed8f87efec1f84b4d` | feat(keys): per-key rate limits, budget, model allowlist and expiry | inventory-only |
| 571 | #3204 | `ffdeaa41584bd81e42bd36b2f5c2a60ca1e4214a` | fix(system-inject): use chat-compatible content part type for array system messages (#3202) | inventory-only |
| 572 | #3203 | `5c9163950b1d4b3a86acbb6f47638c3cb3c2be53` | feat(fallback): per-account RPM cap, default 40 for NVIDIA | inventory-only |
| 573 | #3197 | `ed7a6948a8a717e49d1ee640a46bdbce63452d44` | feat(combos): add per-model test button in combo create/edit modal | inventory-only |
| 574 | #3196 | `056a0c5ed8e9cdf147e7de1a7864780f42f8d7d1` | feat(commandcode): support Muse reasoning effort | inventory-only |
| 575 | #3194 | `36b71238d644667840b0b57b6095e4a531d2e074` | fix(codex): quarantine invalidated OAuth profiles | inventory-only |
| 576 | #3191 | `20f572a6766fd70f3b538abb3e2c7ad83ffd50b2` | fix(providers): add TokenRouter connection test support | inventory-only |
| 577 | #3190 | `8bfc3514f167ecd2220a7485310d3fe176a05879` | fix(kimi): route API-key connections to Moonshot Open Platform | inventory-only |
| 578 | #3185 | `bcb2315af76b868cdab66d7ac513235d5462ac90` | fix(kiro): pin API keys to detected Amazon Q region | inventory-only |
| 579 | #3182 | `4c275fd399ca1304845e01487c6b1f0eb8485fd8` | fix(providers): report active after cooldown expires | inventory-only |
| 580 | #3181 | `ad54fe14c24218a82ccc3e38b4e19e9c393d741b` | fix(fallback): do not rotate accounts for request errors | inventory-only |
| 581 | #3179 | `f2a98ff150eab0c7b55e7c86db534a20542a575a` | fix(runtime): coordinate graceful shutdown flushes | inventory-only |
| 582 | #3175 | `208bf0592895e4ca4f8547d50e69d2c5bbc6d19a` | fix(stream): finalize interrupted streaming request details | inventory-only |
| 583 | #3173 | `1052f086fafac235fbed366f67afb56a2b10ee15` | feat(federation): multi-node edge→central federation (proxy, replication, failover) | earlier-head-only + 1072-composite-open-residuals.md |
| 584 | #3172 | `55a2a07658f670b6d9239a5c40e8c3ea52ee35d9` | Fix/executors cancel sse readers | inventory-only |
| 585 | #3171 | `3cc08bbc79a495de99bf8ae6e6f74bd59ca6d0bf` | Fix/mimo free session affinity | inventory-only |
| 586 | #3170 | `f906331faabbb8e346a0eb68e353badbd21fc47c` | Fix/security credential metadata isolation | inventory-only |
| 587 | #3169 | `3a6d4749efa392cf6b90d394644dad1d391b441f` | Fix/executors model state leak | inventory-only |
| 588 | #3168 | `9bd045492ee47d749aa8420ee0d528e11c88ef7e` | fix(iflow): add accessToken authorization fallback | inventory-only |
| 589 | #3167 | `e72774277c2cfb20c2289caf3d7876ba77af813c` | fix(openai): normalize overlong tool call IDs | inventory-only |
| 590 | #3165 | `d95aa381f29d2a8852c92f702a85d28b22327642` | fix(openai): support max_completion_tokens and forced streaming | inventory-only |
| 591 | #3163 | `6affe0b5bb8ed5b4b23fadc72a1829ebd423e4f8` | fix(usage): make hourly usage chart timezone-aware | inventory-only |
| 592 | #3161 | `4842f75d3ea50146abbe498704240f08e6f998d3` | feat(cursor): bridge AgentService MCP tools | inventory-only |
| 593 | #3143 | `f2ccd04ef0a565eaa8328deaeaf026100f3fb7b8` | fix(cli): don't kill config subcommand processes during startup cleanup | inventory-only |
| 594 | #3125 | `85a4b8fb538b6cddfb81c1480a8a38fddbecae78` | fix(combos): resolve provider-prefixed combo names to member models | inventory-only |
| 595 | #3124 | `d0fb09e894fdb59f4e6db49938d348f5505f0f6e` | feat(providers): add Meta AI (Muse Spark) via the Meta Model API | inventory-only |
| 596 | #3117 | `76ffaf23eccc70ed93c50673bb7f85dc4b4a802e` | fix(translator): preserve image blocks when routing Claude -> Antigravity | inventory-only |
| 597 | #3111 | `6dbcb916fdac3599702f4f97b59e12cf772e1b00` | feat(telemetry): add model, kiro credits, and session id to the done line | inventory-only |
| 598 | #3107 | `74559cf0783b532d4bed3f4f6cbdf995b4460ece` | fix(kiro): restore normalized tool names | inventory-only |
| 599 | #3069 | `abd211c52014d804c27829da7167ec5627518c05` | fix(open-sse): ESM interop fixes for plain-Node consumers | inventory-only |
| 600 | #3066 | `d15fab0261179ce1ed5ff6b367effdad08a83e41` | fix(headroom): skip compress on oversize payloads + disable kompress by default | inventory-only |
| 601 | #3064 | `6ce3a10b695ca7c49341768a47be6d5e7f0ffdab` | fix(antigravity): rewrite MITM proxy host to daily-cloudcode-pa.sandbox.googleapis.com | inventory-only |
| 602 | #3062 | `83319b8c67ec42dbdb1457b37ab3f10123e1b821` | feat(combos): add import/export with capacity adapter support | inventory-only |
| 603 | #3058 | `954358a95a553f67865c5c2fbfb87dd9eab65895` | fix: correct AssemblyAI STT auth header | inventory-only |
| 604 | #3055 | `91a1cc46e61ab9320f7279be64b6fae1c6af6e19` | fix(translator): prevent merging Gemini functionResponse with text turns & fix missing tool responses | inventory-only |
| 605 | #3054 | `78a0203267be9d6e29d63bd2c7db117521ae3901` | Akar masalah: saat request di-route ke openai/gpt-5.1, body body clie… | inventory-only |
| 606 | #3048 | `0ad900474cf6666f4bd6affc0c0ecdb89e211654` | Fix/inline thinking translation | inventory-only |
| 607 | #3047 | `c088ba7e1175b425f30e14227781aa80c750d719` | feat(usage): TokenRouter quota tracker via optional Management Key | inventory-only |
| 608 | #3039 | `26459e573d0901deb886557d3f99c5fd93750a2a` | fix(kiro): canonicalize unsupported tool schemas | inventory-only |
| 609 | #3038 | `82826557fd0a7a3245f515cd698cba6f0860104c` | fix(kiro): support API-key model discovery | inventory-only |
| 610 | #3031 | `d7d1cfbfc4a818668f799f1abd3ea276de5b0023` | refactor | inventory-only |
| 611 | #3026 | `76d5b41f68a79b157304738a0496980010867edc` | fix: stabilize Windows lifecycle and provider reliability on v0.5.50 | inventory-only |
| 612 | #3025 | `f9155234734ce714852264a11de219481e1b1138` | fix: exempt OPTIONS preflight from auth on /v1/* paths (#1381) | inventory-only |
| 613 | #3015 | `fe75f5c67105a254a0cf9c9c2ad59cde844a6e60` | feat(models): add Model Access page to gate what the endpoint serves | inventory-only |
| 614 | #3012 | `c830bdaadc62e3c3a2cd2e6be4875b7ae323fa38` | fix(cooldown): honour provider-reported quota reset times instead of re-probing spent accounts | inventory-only |
| 615 | #2997 | `0b2ac02c9996c4ceda0d991e4ab21da6046b3367` | fix(proxyFetch): add undici connection pooling to prevent connection exhaustion | inventory-only |
| 616 | #2960 | `d1e9d4d24a9710b4836b367e660e29a5adb1b6e8` | docs(i18n): update RTK Token Saver features and 2026 free providers in README.ja-JP.md | inventory-only |
| 617 | #2959 | `0f58c94ca4d916085cb9f8f6aa2e65605a6ad636` | test(api): add unit tests for count_tokens CORS preflight, 400 invalid JSON, and payload edge cases | inventory-only |
| 618 | #2957 | `44a9cabcee8753ae234e426e871a158eafd00f71` | fix(tests): remove hardcoded Unix /tmp/node_modules paths for cross-platform vitest support | inventory-only |
| 619 | #2956 | `97de390d2517d36b67ad57f2209b29ae53b0a902` | docs(i18n): fix typos, prompt artifact, and update RTK features in README.vi.md | inventory-only |
| 620 | #2952 | `d2fd11b11698795a2c4479ef6906304f22162475` | feat(qoder): deep protocol module — reusable Qoder/QoderWork CN implementation | earlier-head-only + 1073-june1-row-dispositions.md |
| 621 | #2946 | `41f0379408995015d2ad42a3fe79a53274c0545e` | fix(chat): replay Envoy buffer overflow on same account | inventory-only |
| 622 | #2944 | `a8c7b9910e69774291ecaf73ee2f7e1fc03addca` | fix(responses): preserve namespace tools across chat translation | inventory-only |
| 623 | #2943 | `bf653e7c560ce727b369b3098ab11565b7d50d9e` | feat(codex): add transparent native provider transport | inventory-only |
| 624 | #2941 | `5b81b5b8145e264615e410feb12882a55b69ba11` | feat(routing): add latency-aware account routing | inventory-only |
| 625 | #2937 | `9ed4470949c9522c0f8fd7f1b456eb1780f68afc` | feat: add one-click model health testing | inventory-only |
| 626 | #2927 | `2b55b9a4145a2daeaa1fa2d82405d26f165b3ce9` | fix(thinking): stop claude-adaptive's unlevelled auto intent from 400ing | inventory-only |
| 627 | #2923 | `fab469024c0f5e912b7e9350b613aaa1d54d5749` | fix(codex): drop optional ids on replayed call items | inventory-only |
| 628 | #2922 | `7b84c4700104d707c21685d19f5e17ad0f826fe5` | fix(tunnel): bypass worker self-signed TLS via TUNNEL_WORKER_INSECURE | inventory-only |
| 629 | #2921 | `694b63d34f46a208dd3fc65925eb8555efa48b12` | fix(cli-tools): mark Amp as unsupported | inventory-only |
| 630 | #2911 | `a2450592318d9afd7415fbb1bbf982603d5f02fc` | fix(kiro): drop top-level systemPrompt for kiro.dev gateway (unblocks -thinking/-agentic) | inventory-only |
| 631 | #2909 | `02969ed167893cd29d0f5306883450cbdcd50e76` | fix(qoder): show organization quota with zero total | inventory-only |
| 632 | #2908 | `ecb5558384b05d27de41144477dff8110871bb84` | feat(dashboard): interactive model sub-node tree topology with real-time active pulse & display mode controls | inventory-only |
| 633 | #2904 | `a178f3bf8f79f0c13a306cc97a34cd9cbe8e70d8` | fix(kiro): convert letter-dot-digit to letter-dash-digit in Claude model IDs before upstream dispatch | inventory-only |
| 634 | #2899 | `d2be588a852bef059c85cdbee8b5b1e4bb523b9f` | feat: add Error Log dashboard, API, and error logging instrumentation | inventory-only |
| 635 | #2895 | `53745527f496f5d033160d689a85ef2230cd781d` | feat(fallback): per-provider retry-delay control | inventory-only |
| 636 | #2887 | `a9fc3d2188d9a7f5cad357a9a0192d605a175598` | fix(openrouter): opt into provider fallback for `openrouter/fusion` e… | inventory-only |
| 637 | #2857 | `4e87dd322fce71c0216089966733a292869af2c5` | fix(docker): remediate trivy HIGH/CRITICAL findings in the Docker image | inventory-only |
| 638 | #2853 | `72d607f7a198fa6001e7a00907220e8199382da4` | fix(codex): preserve quota window duration | inventory-only |
| 639 | #2850 | `7fbfedbb1a1076e3716e026b08dd724404080863` | fix(claude): guard inactive quota auto-ping | inventory-only |
| 640 | #2849 | `bc3c0b0597b26804c735f51239e615a8b82eb72e` | fix(claude): align CLI fingerprint and session headers | inventory-only |
| 641 | #2848 | `2e8b921f78d75fedf23fad0b2e20c43891deec2c` | fix(claude): harden OAuth usage quota polling | inventory-only |
| 642 | #2847 | `5e2d86ce65a874333eb813e8c0301ac9c595d68d` | feat(models): expose runtime LLM capabilities in models info | inventory-only |
| 643 | #2837 | `d003ed88d75c8de189959dfa5ee33a8497f5dfa4` | docs(readme): replace Roo Code branding with Zoo Code | inventory-only |
| 644 | #2836 | `52f6595fe7819147670e44be25e125b2a484d5a1` | feat: add Firecrawl v2 Search provider | inventory-only |
| 645 | #2824 | `f39e8ee4d115b34275683a9fde6e723e17385b14` | feat(ollama): add embedding provider adapter and endpoint support for Ollama Local | inventory-only |
| 646 | #2818 | `947cee616aafc791a4b8a45de9176665b7ced64c` | fix(models): sync discovered catalogs with configured models | inventory-only |
| 647 | #2812 | `ef711be1650f44d83e38fa6d4685d517597bfb78` | docs: prioritize English setup video in Video Guides | inventory-only |
| 648 | #2811 | `62a2e072719f180c981340b3ef8099572369c0b7` | Include commandcode cache reads in usage statistics | inventory-only |
| 649 | #2801 | `c8f6a02d88bca5c492fe422e74eb3996fe70f2a6` | fix(ollama): preserve terminal stream message content | inventory-only |
| 650 | #2800 | `99dc726d3ee42f15945bdad336dc2957637bdc97` | fix(thinking): keep compatible Qwen requests OpenAI-shaped | inventory-only |
| 651 | #2799 | `30785275c63f63977de760edda109d7b751f5795` | fix(combo): avoid Anthropic prefill 400 in fusion panel requests | inventory-only |
| 652 | #2798 | `6584cf35436c8b6ad225bcc04e06d4d4436384ad` | fix(proxy-pools): increase relay test timeout to 30s and use reliable test endpoint | inventory-only |
| 653 | #2796 | `af77163baa5b347a21fe080dfc5a670829084132` | fix(codex): normalize additional_tools passthrough items | inventory-only |
| 654 | #2787 | `94eaf25b5693b809e0324d394e90619537d0be90` | fix(codex): preserve GPT-5.6 max reasoning | inventory-only |
| 655 | #2786 | `f3705be2293f0f50547f1ed588e99a0909f9fad4` | feat(v1/models): add OpenCode and OpenAI-compatible provider model resolution | inventory-only |
| 656 | #2784 | `8b2d316ce4a668420c909a0a5a5a4ae5496f84cb` | feat(providers): add configurable error cooldown policies | inventory-only |
| 657 | #2783 | `0d2a3bb454f9a37aefa0a2b67511296630fea0e2` | fix(translator): carry Structured Output across the Chat ⇄ Responses hop | inventory-only |
| 658 | #2777 | `b190399ebcb9e970d2063d4c73707a655f71d150` | feat(dashboard): add bulk enable/disable for provider connections | inventory-only |
| 659 | #2776 | `cf284cab60ddde4df387f877399b4cec10999d49` | fix(db): encrypt provider connection secrets at rest (AES-256-GCM) | inventory-only |
| 660 | #2775 | `fc8daf7b289b7a8ac04e3b80c43e197814179d26` | fix(privacy): disable Google Analytics by default, add opt-in toggle | inventory-only |
| 661 | #2774 | `a9065970b332c84d9bea82793011faa45f8924b4` | fix(non-streaming): keep reasoning_content by default, make stripping opt-in | inventory-only |
| 662 | #2770 | `ea18e5653e619bbeeee190e510d1605e2d091bb8` | feat(usage): surface Claude thinking token counts to clients | inventory-only |
| 663 | #2769 | `11678c940e13ef544c7b454102eddcf4b1552b0e` | feat: add multi-reference image generation and quota-aware failover | inventory-only |
| 664 | #2761 | `ca25c6ec1560cce410af8c1af78abb0296fb1110` | fix(github): route Claude models to Copilot's native format via chatCore | inventory-only |
| 665 | #2760 | `3d0ba4b54b107f1c9520f2d7e54ff4819a04af42` | fix(capabilities): correct thinking format and limits for the 4.6+ Claude generation | inventory-only |
| 666 | #2756 | `3ddf918f29f0772b7c1c820b0d8378f88a8ae113` | fix(github): enforce Claude prompt limits | inventory-only |
| 667 | #2755 | `c8d83f39f659705c23721c84aeffeb4a333ee6a2` | fix(cursor): implement real PKCE OAuth login | inventory-only |
| 668 | #2753 | `60d129d83082badb63286d5efe1a096ea5240457` | feat(antigravity): add gemini-3.6 (low/medium/high) models | inventory-only |
| 669 | #2748 | `ec02588cc192bdddc9581b459039f301becff112` | fix(cli): clean staged Next build before compiling | inventory-only |
| 670 | #2747 | `20b38fa46e8d24666687545a919b0650d30ba582` | fix(responses): keep translated output indexes unique | inventory-only |
| 671 | #2736 | `705f1a2dddf8bfb9d8eb2d2be418d8f1dbbe18f3` | feat(routing): add opt-in cache-affinity account selection | inventory-only |
| 672 | #2732 | `8843fe0de3817e68f3a7be36dfd025f7d68f5b2d` | docs: add Persian YouTube tutorial for connecting 9Router to coding a… | inventory-only |
| 673 | #2731 | `15ed7b9602867784e8550fa5a1dea5eb3ac12920` | refactor(kiro): keep terminal integrity transport-only | inventory-only |
| 674 | #2725 | `347358e808b40718375e1313845e447d78ad7144` | security: bind dev/start to 127.0.0.1 by default | inventory-only |
| 675 | #2724 | `858ff8267adfdcaf1c78d4bf4c5738eb98dfd242` | feat(grok): show current-day request usage | inventory-only |
| 676 | #2723 | `dc963efaf0c60658043e663f5cb258549b257dfc` | feat(quota): denser tracker UI, Available filter, 7d-hourly graphs | inventory-only |
| 677 | #2713 | `8817537ba0a7b9b0b8dc877f832827d92933de2a` | Fix OpenAI Responses stream reconstruction | inventory-only |
| 678 | #2710 | `1548ea6495175f727f4b7b7144229e5e0d232bfd` | feat(observability): correlate request attempts | inventory-only |
| 679 | #2709 | `71a8141a0c9d9654fbf7cb5388d045d56fdc70d9` | fix(logging): redact credentials from request logs | inventory-only |
| 680 | #2706 | `6c9ab1d17fd2b4858359738c1eb5852ffc987011` | fix(minimax): normalize unsigned thinking block starts | inventory-only |
| 681 | #2705 | `ff26f2745c2c3e73893486264a928bce61fa6e7e` | fix(minimax): align request body with selected transport | inventory-only |
| 682 | #2699 | `937297ab45309fc9ddd4a79ed2a2b4eccc336fcd` | fix(cli): default to IPv4-first DNS resolution to avoid undici IPv6 connect timeouts | inventory-only |
| 683 | #2697 | `1ac55a4f8cdd4f898c3ef439a89e6674f91bdcce` | fix(capabilities): support bare Kimi K3 upstream id | inventory-only |
| 684 | #2691 | `3333226522bf974b8aa5a384a08f5b362c42cd09` | fix(azure): rename max_tokens to max_completion_tokens for reasoning deployments | inventory-only |
| 685 | #2689 | `397dd16bc382aca829fff45f0b1988051583cb9a` | feat(combo): validate empty 200 responses with retry-before-fallback | inventory-only |
| 686 | #2688 | `4bbba263ad29b2df793cf68cc46647a250d2287d` | fix(kiro): retry malformed tool_call wrappers once | inventory-only |
| 687 | #2686 | `d583c5d255647e76dfbc45c50d4948fd1c1b57d9` | fix(combos): show non-media combo kinds | inventory-only |
| 688 | #2681 | `fa842aece4b6e3954a5cec45262c54110d8773f9` | fix(kiro): validate completed nested tool_call payloads | inventory-only |
| 689 | #2672 | `5ed1068e11d6b7d54a62ab648db6cb779210e2a6` | feat(xai): track OAuth quotas in dashboard | inventory-only |
| 690 | #2668 | `a78933577aa4e0e61d9c83aec19e61ffc92dbadc` | feat: include usage data in database backups | inventory-only |
| 691 | #2667 | `64dfe5fae0647907a1474fb544baca0e3394f7f1` | fix(codex): recover invalid encrypted history | inventory-only |
| 692 | #2666 | `c3717474a8473a493774d9c6250c88da470475ea` | fix(responses): keep explicit streaming requests alive | inventory-only |
| 693 | #2664 | `3f94a5c459ed7973c8716325d60450bb575d69fe` | fix(kiro): distinguish confirmed credit exhaustion from ambiguous 402s | inventory-only |
| 694 | #2663 | `f28309912e4e3f2ce554fb21bd8f80a0580def19` | fix(claude): reconcile compacted tool results | inventory-only |
| 695 | #2649 | `3875c2a9c7b0a3e596e48bfb4cc9d9c3f2175a8f` | fix: normalize nested Claude server tool models | inventory-only |
| 696 | #2647 | `d0c5b59c5b3797a1da8286cacb96f466803b4334` | fix(grok-cli): complete residual Responses codec on v0.5.45 | inventory-only |
| 697 | #2646 | `89d345a18169c86fe0a7db0728474a038beab615` | feat(combo): add per-model timeout for faster combo fallback | inventory-only |
| 698 | #2645 | `202eb231b355eaaf92690730f3b26b0bc8af7a68` | fix(models): compatible-provider discovery + strip cc/ prefix from Claude DEFAULT_MODEL (#2626, #2642) | inventory-only |
| 699 | #2639 | `7ffc069f4594c407c9330362f38435f6bf36899e` | Keep round-robin accounts sticky by session | inventory-only |
| 700 | #2634 | `6a135f5f7fb7f8996004a7c125205ff4aac40271` | fix(translator): flatten multi-block text content parts, preserve multimodal | inventory-only |
| 701 | #2615 | `da0b4687ea582e3ac5f301e80779ce53464ed19d` | feat(kiro): support native external_idp refresh token import and validation | inventory-only |
| 702 | #2600 | `6c3a8c02f6b0ee3853d8152595ee609dfeb336cb` | fix(huggingface): add sttConfig so HF STT presets are dispatchable | inventory-only |
| 703 | #2589 | `1587465190d37aac518121edefe219b2d969c7c9` | feat: harden proxy routing and couple MITM lifecycle | inventory-only |
| 704 | #2576 | `2e94bee72b0076aecf4f4e11bbfd8d8f975ef368` | sync | inventory-only |
| 705 | #2573 | `7824ebb211141cf57cd5e26e97bc94a2ac3e7529` | fix(byteplus): use standard ModelArk endpoint, not Coding Plan endpoint | inventory-only |
| 706 | #2572 | `5a290edc9afa7aaf00c249312c62c743bfb6836a` | fix(grok-cli): parse SuperGrok percent-based billing for quota tracker | inventory-only |
| 707 | #2554 | `47119f9f7c1e36083e3e55cd308c3c6389764701` | fix(console-log): fall back when tunnels buffer SSE | inventory-only |
| 708 | #2553 | `d270e05dc6a3877690f210e2608ff3af6a5f78a0` | feat(usage): show API key client activity | inventory-only |
| 709 | #2550 | `ca32e62c602e6a566bee46a8689cdd11b8464300` | fix(combos): disable circular combo selections | inventory-only |
| 710 | #2547 | `4462dfce8d5974a344ab9b78ec763e12afef1798` | fix(openai): route GPT-5.6 Sol tools through Responses API | inventory-only |
| 711 | #2534 | `63b8bc1f618b756eafeaf0a38aeb1c126bfdb4be` | fix(xai): strip reasoning_effort for grok-composer; dashboard thinking None | inventory-only |
| 712 | #2533 | `7fbc039129dbfae29da6c3263a400ce1a653341c` | fix(minimax): route M3 tool calls through standard API | inventory-only |
| 713 | #2528 | `45d8f39a1a0f2a941b88bc2d06e2a4f74dc31edc` | Railway  | inventory-only |
| 714 | #2526 | `e18bed6a0bfa076d95ae33ef72e6ec5bd6b57d1d` | fix(combos): hide disabled provider connections | inventory-only |
| 715 | #2508 | `6b2eaf0b40fbe5e4e246e2092c07fa2a0a719764` | fix(codex): inject token saver prompts as instructions | inventory-only |
| 716 | #2474 | `80ee0f89bfa629e0c08a4b01276aa05eac4b0087` | Add Node.js CI workflow | inventory-only |
| 717 | #2465 | `526e4e81efcdc298561d02d3d57e9dabe535f23f` | feat(pxpipe): PXPIPE token saver — multimodal prompt compression (in-process) | inventory-only |
| 718 | #2462 | `77cdba64c3aef8549f7b325e43b989d7aad95485` | fix(antigravity): retry empty streams, surface aborted turns, finalize truncated Claude streams | inventory-only |
| 719 | #2454 | `ef9826ae28b28e55247ad89ffb279ac22364f951` | feat(keys): add daily token limits | inventory-only |
| 720 | #2453 | `acd506c7bf6d6da403103c8410ab3f79a1cfea0d` | fix(usage): preserve nonnegative provider-reported exact cost | inventory-only |
| 721 | #2452 | `8b77ba8699511301a961618d5cc591fb61b9c6aa` | fix(codex): preserve GPT-5.6 max reasoning | inventory-only |
| 722 | #2443 | `82fd34caf0848872ccc0bc6ef7355f7b5809de58` | fix: prevent duplicate system prompt injection in multi-turn conversations | inventory-only |
| 723 | #2439 | `6e1c9e8c08d147aa9e2375500a9ea4def1f0a6d5` | feat(xai): expose current Grok models and bare routing | inventory-only |
| 724 | #2437 | `a6471bf25d8d045b2423eb0d86dadc4452c872fd` | feat: add Chenzk API provider | inventory-only |
| 725 | #2422 | `c3ee4f68e2bd2925ccf3ed9c9b5b50148bf0dd31` | fix: keep usage api key groups distinct | inventory-only |
| 726 | #2414 | `2d77831f750cd4bbe4c8677b153922a1a1d07ce5` | fix(cli): fast-path help and version flags | inventory-only |
| 727 | #2373 | `a50f9d3747d63641ca6545f0fec413ad05ed415a` | fix(nvidia): expand NIM chat model catalog | inventory-only |
| 728 | #2364 | `669b1996a8b93dac08f9e17f1e1fd7eaeee2e1ce` | fix(usage): keep API key stats distinct | inventory-only |
| 729 | #2345 | `f504501f8c6a10b1d018026506ef6453f453da7c` | fix(codex): normalize available reset credit expiry | inventory-only |
| 730 | #2068 | `25f5bec5f69e20e00998fe9dcc42524217adf390` | fix: retry upstream streams before output and preserve terminal status (v0.5.119) | earlier-head-only + 800-scan-reconciliation.md |
| 731 | #1819 | `46226233f89601b4cd7a1596c3d613d4e3614060` | fix(codex): bind usage and quota calls to ChatGPT account | inventory-only |
| 732 | #1367 | `0b311735f0334c1ab0f270c953dc75cb82ecc9d1` | Codex import | inventory-only |
| 733 | #1272 | `73761af9e14a867e8c771cab47017ec58e7d1c1f` | fix(chatCore): default stream to false per OpenAI spec (#1260) | inventory-only |
| 734 | #1264 | `34a11f9b549a1e682b15c828da16c03aaf2235cf` | fix(translator): strip temperature for Claude models with extended thinking | inventory-only |
| 735 | #1161 | `d56de78edd56308265edd2e2671b6a1084f16d83` | My master | inventory-only |

## OmniRoute

| # | PR | Current head SHA (full) | Title | Why pending |
|---:|---:|---|---|---|
| 736 | #21156 | `c0537bfc742d7851b1a84c4357154ac4e3c8a383` | fix(compression): allow whitespace-normalized code blocks in exact presence validator | inventory-only |
| 737 | #21155 | `e30315f392ee022ead0988760e1a94558bb77001` | fix(backend): break circular dependency deadlock on Qdrant enable switch (#21115) | inventory-only |
| 738 | #21154 | `74b1eb172736d462467cf3d0140ae50404a213f6` | fix(cli): load CLI plugins and resolve npm wrapper on Windows (#21056) | inventory-only |
| 739 | #21144 | `0f44c53541db54be798cf3e813394a9477ddd03f` | fix(antigravity): stop excluding every Gemini 4 model on accounts without Argon | inventory-only |
| 740 | #21141 | `3fad895199dafc83a06f1cbed9df81bd754b2156` | fix(compression): preserve tool results in compression profiles | inventory-only |
| 741 | #21140 | `8ab6430a9be966264fb34a4ad7379e182134b099` | fix(sse): cancel abandoned recovery streams | inventory-only |
| 742 | #21136 | `5912079be1588192360405f762fdd06462aa0e43` | fix(sse): omit buyer cost from native Claude stream usage | inventory-only |
| 743 | #21135 | `b143d7a9ed834e0e67454d72cb38eb03cd56c78f` | feat(usage): add opt-in reasoning effort collection for call logs | inventory-only |
| 744 | #21134 | `4b7bd1081c57d0ffe4979e24002a6e71278fc22d` | fix(logging): attribute failed empty-content retries to the fallback | inventory-only |
| 745 | #21133 | `1049c85bc31bb89f031f324098ec611b3956f075` | fix(images): preserve OpenAI publisher IDs in legacy Fal routing | inventory-only |
| 746 | #21131 | `aad491dac34c419594352182aa9f7a0fedd24c8a` | feat(webhooks): connection.auth_failed names the account that failed auth | inventory-only |
| 747 | #21125 | `3a57400a04b48d744aa2986cd950b6cd352f7a81` | fix(memory): allow pre-activation Qdrant health and search validation (#21115) | inventory-only |
| 748 | #21124 | `ba6b35ac1b90897b324c07a5b9fe7af0cbb9505b` | fix(compression): allow whitespace-normalized preserved blocks in validation (#21117) | inventory-only |
| 749 | #21122 | `81402046cbd2051570487e177581d6898fa0fbef` | feat(providers): add opt-in text-only Kiro CLI over ACP | inventory-only |
| 750 | #21121 | `8781ddb0c8904574cd09009a6738d3b2c5f4aa11` | fix(models): let registry additions reach providers without discovery config | inventory-only |
| 751 | #21120 | `93583ec446daa5bd368ef9837e47b5679910c6f7` | fix(claude-web): post conversations to the chat organization, add Claude Haiku 5.5 | inventory-only |
| 752 | #21119 | `31894a693781d06b3a809edeaa45cb8f90a1a05a` | fix(gemini-web): read the answer from the DOM, select Gemini 4 modes from the model menu (#21116) | inventory-only |
| 753 | #21114 | `e2a50ba4a135b55db485129d76b2a71b27800a57` | fix(usage): keep reported DeepSeek cache-hit counts | inventory-only |
| 754 | #21113 | `d011d9ec2a8082db3966f82a3102188d11a84f6a` | fix(usage): retain Gemini cache reads in partial stream usage | inventory-only |
| 755 | #21112 | `84a2f3462399f313f6cb472d7aaa49296085a6af` | fix(compression): start packaged Turbopack workers from disk | inventory-only |
| 756 | #21111 | `72c5c32f0ebe6704be2233d683b931bb5e5ab253` | fix(mcp): preserve bounded full CCR retrieval | inventory-only |
| 757 | #21110 | `88fc660ada7c01c803f58f60d7e01211d5789e6e` | fix(usage): preserve nested cache-write counts across streaming translators | inventory-only |
| 758 | #21108 | `7fa2a13336bab04bfc9b6235ed44b9ce610027d0` | fix(usage): preserve recent cache-read completeness | inventory-only |
| 759 | #21107 | `f6235ae61b44e8633e1e785384f28eb185844c61` | fix(dashboard): show live cache-write token counts | inventory-only |
| 760 | #21106 | `bd7ced4d0c8514a63ccd4c61f10c779607335f1f` | fix(usage): preserve reported OpenAI Chat stream totals | inventory-only |
| 761 | #21085 | `3cabc8cc8eb183f48d75eeefe4a83f1db491acd2` | feat(dashboard): show API key bans and reason categories on Home | inventory-only |
| 762 | #21084 | `bee2f027503e8e265d9a3d9add1f42d3425f44c8` | fix(providers): derive per-conversation Codex prompt_cache_key instead of workspaceId fallback | inventory-only |
| 763 | #21078 | `db60fe53daca6a2cfa8e2c4dbbb87ec3132949c1` | fix(images): normalize the OpenAI JPG output alias | inventory-only |
| 764 | #21074 | `f11f26b0fdd574aa6334e1df127366e7d838a1f3` | deps: bump the production group across 1 directory with 58 updates | inventory-only |
| 765 | #21072 | `a866c5ad1ca3c6b0484a79d3f2a8297f41b9b46d` | deps: bump the development group across 1 directory with 18 updates | inventory-only |
| 766 | #21070 | `2052f9d606b18dacfa85d563e47412a9a5db3fec` | deps: bump electron from 45.2.2 to 45.4.1 in /electron | inventory-only |
| 767 | #21069 | `70e5d6f952af2ba9740a10896ced69345223a5a6` | deps: bump oven/bun from 1.4.4-slim to 1.4.5-slim | inventory-only |
| 768 | #21064 | `64af3ff5dc56ac0b2e55b2833358533c17c59f8f` | feat(api): opt-in provider label in /v1/models model names | inventory-only |
| 769 | #21063 | `23c8d6691f126968af8cd443a236e9286d12c5a2` | feat(api): opt-in lean catalog setting for /v1/models | inventory-only |
| 770 | #21061 | `4e227675e4c3d0eb6303b8bb60cb0c2f8279a0eb` | fix(ci): decouple SonarQube from release admission | inventory-only |
| 771 | #21059 | `5e2343c5599ddf327356bcfd0d2dd2550fe2a553` | fix(ci): verify OpenAPI path parameters on main | inventory-only |
| 772 | #21058 | `cab4f4f905642bfe395fcb6648910c1fb22a54d4` | fix(ci): validate translated content before opening mirror PRs | inventory-only |
| 773 | #21055 | `f0ae592bae55115895e282da85696ef2fe2be3ee` | fix(dashboard): clear the payload copy timer on main | inventory-only |
| 774 | #21052 | `e73454a5966a5bfedf6335b85c7766dd00456306` | fix(tts): route MiniMax China speech through its regional endpoint | inventory-only |
| 775 | #21051 | `403ebe87d6d467af45035246fdbbca92941e4e09` | fix(resilience): return a request-larger-than-limit 413 at once | inventory-only |
| 776 | #21050 | `6105894cfcf0de791d096bdcee4ba661ca28afc8` | feat(contrib): add muse-bridge for Muse web accounts | inventory-only |
| 777 | #21048 | `84ba23acd727c11038e066f650297cd568e916c4` | refactor(db): import parseStoredPayload from its leaf module in core | inventory-only |
| 778 | #21042 | `2166afce10f95518e7c7493cd3768f331e78ceee` | fix(vertex): strip trailing model turns before Vertex AI dispatch | earlier-head-only + 1073-nov22-verify-os00.md |
| 779 | #21037 | `50080e49cbe11ff1ba38b8c924660919b576f781` | fix(security,config): warn on DB REQUIRE_API_KEY override and remove literal .env.example secrets (#21014) | earlier-head-only + 1073-nov22-verify-os00.md |
| 780 | #20994 | `ba7567932cd053f157fc4cfa6eb11098f0801729` | feat(providers): add WaveSpeedAI image and video generation provider | earlier-head-only + 1073-nov22-verify-or00.md |
| 781 | #20993 | `83bb57a002436aa1d56cccf8a968f6150fad4950` | chatcore/credential-health: write real request outcomes back to the connection | earlier-head-only + 1073-nov22-deferred-00.md |
| 782 | #20981 | `6124a1c899680211f9fd5010076c8e1fde82e170` | chore(docs): refresh derived numbers on release/v3.8.55 | earlier-head-only + 1073-nov22-verify-or01.md |
| 783 | #20966 | `64a069737556548341f6c35e8e44be50b3978ab7` | Refactor Neon persistence and enhance SQLite durability features | earlier-head-only + 1073-nov22-verify-oc01.md |
| 784 | #20964 | `f5b230444b348a8289448fafc0dfbd2edd3fd519` | test(opencode): synchronize catalog refresh tests with host replay | earlier-head-only + 1073-nov21-open-ledger-c.md |
| 785 | #20960 | `0aeef265f28fb897353b8863bda880bfab43efa2` | fix(providers): resolve per-model provider.api and inference/go base for opencode-go (#20881) | earlier-head-only + 1073-nov22-verify-oc01.md |
| 786 | #20953 | `9ba9ce9e48fd182fa937e0c3736877fabfd18a90` | chore(docs): refresh the published migration count | earlier-head-only + 1073-nov21-open-ledger-c.md |
| 787 | #20952 | `2273b2ad73bb1b5ccf0ea7ff3a861a14d6f4d2a6` | docs(i18n): translate the CLI P2C latency weight | earlier-head-only + 1073-nov21-open-ledger-c.md |
| 788 | #20945 | `7eeb0056f0eb249cc76ebf85d49af2b655cee48b` | refactor(db): move quota group, model-cap and schedule definitions behind repositories | earlier-head-only + 1073-nov22-verify-oc01.md |
| 789 | #20884 | `1cdb755268472cc2e7dedb238ccf0b37981745eb` | fix(ci): split Node 26 compatibility into eight shards | earlier-head-only + 1073-nov21-open-ledger-c.md |
| 790 | #20883 | `2fd20cc6209318c9c9adbe5983fa11aacc3a57fb` | fix(runtime): preserve cleartext h2c request bodies on Node 26 | earlier-head-only + 1073-nov22-verify-oc00.md |
| 791 | #20882 | `e424db97c1231b7af9d16905b9924343e3fc3faf` | fix(ci): pin the revision in nightly Node compatibility | earlier-head-only + 1073-nov21-open-ledger-c.md |
| 792 | #20880 | `f269b4cf6c70270cee35e2e5137373e944b980df` | fix(sse): keep HTTPS IP proxies compatible with Node 26 | earlier-head-only + 1073-nov22-verify-oc00.md |
| 793 | #20876 | `5e29561d06842c424d6e01e9bb216e3a59b69624` | fix(db): make SQLite cleanup non-blocking and offload vacuum snapshot to worker | earlier-head-only + 1073-nov22-verify-oc00.md |
| 794 | #20874 | `e46b3618fcc4b10d701512b95b9e12188a9e0a0f` | fix(settings): render an environment-only feature flag as read-only instead of a failing toggle | earlier-head-only + 1073-nov22-verify-oc00.md |
| 795 | #20830 | `e7a18946b83f2985126908899431fd1f3a1d0369` | fix(combo): release a fallback context pin once its prompt cache has expired | earlier-head-only + 1073-nov22-verify-ob03.md |
| 796 | #20806 | `095b0ec5917598b1d6e4f9d2c0a367c9b4dd407d` | chore(deps): bump actions/setup-node from 7.0.0 to 7.1.0 | earlier-head-only + 1073-nov21-open-ledger-b.md |
| 797 | #20804 | `8697ed68b6b1d2d2bb1fc62e9b4e537f4057e998` | chore(deps): bump actions/checkout from 5.1.0 to 7.0.1 | earlier-head-only + 1073-nov21-open-ledger-b.md |
| 798 | #20797 | `04a395c7ce4571435b00b867f17350fef9a7c882` | test(zai-web): shut the pool down so the headed-launch probe exits | earlier-head-only + 1073-nov21-open-ledger-b.md |
| 799 | #20796 | `ca9b63f8c667ed015e73958cc163731ca2688424` | feat(gemini-web): bridge authenticated SOCKS5 proxies through a loopback listener | earlier-head-only + 1073-nov22-verify-ob01.md |
| 800 | #20746 | `517e26f4a3175a9214ad9bd58d2e7e93397d6d26` | fix(dashboard): match accessible names to visible control text | earlier-head-only + 1073-nov22-verify-ob00.md |
| 801 | #20739 | `ce225f129566090341905e67b365e3d098406f77` | fix(gemini-web): honour the account's proxy on the browser egress path | earlier-head-only + 1073-nov22-verify-oa00.md |
| 802 | #20722 | `31195d5bab8f395548037cdb950cfe8b6ce6398e` | fix(ci): align observer unit shards with native CI timeout | earlier-head-only + 1073-nov21-open-ledger-a.md |
| 803 | #20721 | `eeecc3a77cab4f17429cf54931032b762c656925` | fix(quota): stop Codex preflight from blocking requests on routine quota refreshes | inventory-only |
| 804 | #20715 | `3cd6e687bc432bb80b7358bc32d17d8b8a488d73` | test(ui): unmount Cursor nudge roots before jsdom cleanup | earlier-head-only + 1073-nov21-open-ledger-a.md |
| 805 | #20711 | `5aca64dde9cbc96f06c3573a4f11ab9de11dc155` | feat(routing): prompt-level combo tags — "[audit] …" selects a combo, sticky per thread, explicit model wins (#20706) | inventory-only |
| 806 | #20709 | `d2395323284efa5e2a354016b9840f3016926d99` | fix(codex): let edu_plus accounts serve Sol and Astra | inventory-only |
| 807 | #20701 | `2756bce17233ea4cf5c9793e08e74e5dc33b445e` | feat(providers): add gemini-app native provider with usage quota | inventory-only |
| 808 | #20700 | `7314f099c9a5a19e16aae6298405bdd0c332f5f5` | feat(providers): MegaBrain image and video generation | inventory-only |
| 809 | #20698 | `c8c8c72c8b84d0b9823d7caaec0e759312cc8b03` | fix(ci): isolate PR metadata revalidation from active head runs | earlier-head-only + 1073-nov21-open-ledger-a.md |
| 810 | #20696 | `5b85daabcb0297ca834becb6ca31126164f29c43` | fix(api): forward quality and background on image edits | inventory-only |
| 811 | #20693 | `de8279d500e4894c7341cc428354542236765198` | feat(providers): catalog refresh for Xiaomi MiMo V2.6, GLM, OpenCode Go, SenseNova, Codex, GPT Image and Nous | inventory-only |
| 812 | #20692 | `f33e43c9df7fd04b7ea34956e7f5a72cd356c626` | fix(db): keep Claude device identity and operator settings across OAuth re-login (#20620) | inventory-only |
| 813 | #20691 | `b0a29c63c76f864f0407fb96268fe62e4cbec52e` | feat(providers): opt-in allowOverwrite:false refusal and one-transaction connection renumber | inventory-only |
| 814 | #20688 | `df71f2cc050ef9f58696b37af33ddbeab04b1fbf` | fix(sse): drop a forced tool_choice for DeepSeek V4 when thinking is on (#20639) | inventory-only |
| 815 | #20687 | `d4eed52fcc1bb2736227f0fe19a8f3b533b84b1c` | feat(providers): opt-in "Thinking capable" flag for custom models | inventory-only |
| 816 | #20685 | `cbdc8f8755c5fee6a4bfa1a26b20cf54d3d15a0d` | fix(conversations): read turn display content from top-level requestBody (#20623) | inventory-only |
| 817 | #20684 | `f49eb7ee33055c3952a47790ad9b40e0a2c3fea0` | feat(images): record Codex image tool usage in the call log only | inventory-only |
| 818 | #20683 | `b28ceec5e36b81ab5effb83b02f6118c080ceca3` | fix(resilience): scope model_not_found lockouts to the missing model on codex (#20622) | inventory-only |
| 819 | #20682 | `03ca02484a4466669fa3a6b26afa3da7169ae048` | feat(audio): add keyless ollama-local speech (Phonon) provider | inventory-only |
| 820 | #20680 | `2574b2b8f094bd8a70054c0ca72e87310d6efc0e` | feat(search): add fallback-only TinyFish search provider | inventory-only |
| 821 | #20675 | `92062de138edf23eb1c7d75eca129cf002b1cb32` | feat(compression): opt-in Gemini tool-output projection for compression | inventory-only |
| 822 | #20673 | `f5ece1afde7860e2b1a5d2c39f55007e547609a0` | feat(providers): opt-in Claude refusal explanation as assistant text | inventory-only |
| 823 | #20668 | `8daf1438ed059362add6566b8dadcdb65b8d34c9` | feat(providers): add opt-in Responses format for Kimi Code connections | inventory-only |
| 824 | #20666 | `f74841a5f7624c56458e98592c5599f088ade9cb` | fix(providers): register Gemini 4 Neon tiers, pricing, alias and output cap | inventory-only |
| 825 | #20655 | `b10f81d87e6361dbc3ef39dc4c8a6746382a1b20` | fix(freebuff): implement client attestation, catalog handles, usage tracking, and session-preserving fallback | inventory-only |
| 826 | #20654 | `a0b905566929217e2f59431fb7134c7350fc9f63` | feat(dashboard): hide fixed reasoning variants on the OpenAI Codex provider | inventory-only |
| 827 | #20653 | `795ce6fe7278b29b5c437565af7e6c7b81a4a20e` | fix(dashboard): list decision endpoints and count matching catalog models | inventory-only |
| 828 | #20651 | `ac34411b99853e1cd57e677d94bc5a3daab0d21c` | fix(codex): keep a translated system prompt in input so GPT-6.2 can cache it | inventory-only |
| 829 | #20648 | `19d1f43b6913542ca56e2982a9c35a4f4dc835a5` | fix(api): use the native Gemini Decisions endpoint for model tests | inventory-only |
| 830 | #20634 | `17fd31d4504cd7b4dc5981e7a5be888661cf42aa` | fix(search): enforce Keenable domain filters on its results | inventory-only |
| 831 | #20619 | `a8267308d35c8cb664bb942f33140a2e84ed4462` | feat(api): support native Gemini Developer API decisions | inventory-only |
| 832 | #20618 | `d7886cbd6913f6a6145d9c147ef2d50e43f175e0` | feat(api): support native OpenAI Platform decisions | inventory-only |
| 833 | #20613 | `b483f7ac311c82f5edbaeb4c872a5bf980217030` | feat(usage): allow configuring provider limits sync concurrency via env | inventory-only |
| 834 | #20607 | `c521fc6689e0a59400a9dbb481a336566f2b436d` | Fix/memory key injection orphan | inventory-only |
| 835 | #20597 | `32ad09010c61a3d8a1f64801724a6b19f5641852` | fix(embeddings): default input_type for NVIDIA NIM asymmetric embedders | inventory-only |
| 836 | #20596 | `7c45cbe29e9473b9056a1342aecaaf14012ac70d` | feat(home): usage summary and provider quota on the Home page, with visibility switches | inventory-only |
| 837 | #20582 | `79af3ceea432a69ec190166a32610c1a370e3f83` | perf(batch): avoid copying each character in CSV records | inventory-only |
| 838 | #20563 | `b57b90ba89d7a90d3e2edfd64ff47a34c5f5501f` | feat(plugin): publish one provider per upstream canonical when opted in | inventory-only |
| 839 | #20562 | `e87d3cceb57f23d5756cc1bf5240902c6671ce23` | fix(mcp): keep caller identity for cookie-only and x-goog-api-key MCP HTTP calls | inventory-only |
| 840 | #20559 | `ef5679a2fa2a2d7ca030bb1a353b77474e4aaf02` | fix(sse): keep system image parts when folding roles into the user turn | inventory-only |
| 841 | #20549 | `39b74e61f044256f2ff0205dbf0c9965a7c2873f` | fix(analytics): show exact partial Input Tokens when cache reads are unknown | inventory-only |
| 842 | #20537 | `20bc820dee7a2f581a860df7454468fb479f02f9` | fix(sse): keep the requested provider id first for OAuth alias pools | inventory-only |
| 843 | #20530 | `d038a640e12137cb2ad942f8812449028dbacae7` | fix(combo): fail over masked 200 billing notices in SSE delta content | inventory-only |
| 844 | #20527 | `851d8e53e5e87b608bf33454d759237d083ca06d` | feat(sse): opt-in newest-generation ranking for built-in auto routes | inventory-only |
| 845 | #20525 | `8d31012faf4d54f5713a0a6f20136c2d28263eb1` | fix(codex): guard OAuth account identity during refresh and quota fetch | inventory-only |
| 846 | #20524 | `a62b80d7a5bfc5a06e0646fa1500c204c5a784c5` | feat(quota): generic quota window auto-ping targets | inventory-only |
| 847 | #20523 | `179d71cba611a7e33f2ed83334045414470dcf07` | fix(api): expose configured provider node name in /api/pricing/models (#20518) | inventory-only |
| 848 | #20521 | `71777b67a7459b2e408f021c21a182ba9d7b8d62` | fix(openapi): make the tier checker method-aware and align the loopback annotations | earlier-head-only + 1073-nov22-verify-or02.md |
| 849 | #20519 | `7705de1eb40467a95b675c58e34c2b23521c9b5f` | feat(dashboard): optional auto-compact window in Claude onboarding snippet | inventory-only |
| 850 | #20517 | `f7b75420ae511db1d30521d95e432a7b919186c0` | fix(sse): size last-resort compaction to the live input cap | inventory-only |
| 851 | #20513 | `6f070f27166a1a1dcb3f088b4f6c0d07eaf9ee0d` | feat(providers): support MiniMax H3 image generation | inventory-only |
| 852 | #20508 | `b6a97903583e2ea03849bb1d21bc4508299bcc25` | fix(sse): give metadata its own redaction window instead of the answer's | inventory-only |
| 853 | #20491 | `90613d4ad4a00cab73fea84546198bd605ae6639` | fix(responses): normalize usage counters in buffered SSE replay completions | inventory-only |
| 854 | #20485 | `8e31ba7481163e76ab2c222153d75937f30ea7f3` | fix(api): clear inherited typecheck debt and repair request contracts | inventory-only |
| 855 | #20484 | `cc25c43cc6d8444ab2ca4d9b77f0ad2de404bd50` | fix(build): verify standalone workers on direct builds | inventory-only |
| 856 | #20479 | `2fb4e2a0a37cdbaf6c6ea35cfc90fa25e4cd8dd9` | fix(cache): sync semanticCacheEnabled across settings stores (#20399) | inventory-only |
| 857 | #20472 | `5e682c65cdf991b61eda37935fda90ce9bc0b20b` | perf(batch): reject oversized batch files before parsing | inventory-only |
| 858 | #20470 | `871c306195ef4db9a9ea393d0b40e906f399e51e` | fix(perf): bound SSE buffering and Codex image fan-out | inventory-only |
| 859 | #20469 | `6394d40a9fe623a0637073f1d068f0687293fee3` | fix(sse): keep agy's quota status through the tui transport | inventory-only |
| 860 | #20466 | `513389429ea22a9f583fe3496a5c89b83c775093` | fix(usage): estimate request-body tokens once per body, not on every SSE chunk | inventory-only |
| 861 | #20462 | `e9ea0e2130cb4cfa88b26b7cf802cb2757d153fe` | fix(routing): use one error verdict across preview and failover | inventory-only |
| 862 | #20459 | `3f078b7f3a1a7a68c217a38b2d33d8de10b7417e` | refactor(sse): unify Antigravity project persistence into one module | inventory-only |
| 863 | #20457 | `ed73d7d3d509c30fd6e8f406a9f3d14b3bf431da` | fix(resilience): cap relative-prose quota resets with a dedicated ceiling | inventory-only |
| 864 | #20444 | `40dce8fced97ce68c49dbb8894b7e63e5be8676c` | feat(providers): integrate native Rosebud asset generation | inventory-only |
| 865 | #20433 | `8f3ae79a12af7dcb9cde74a5fc8b6b5385aab33a` | fix(sse): protect the provider-cached message prefix from prompt compression | inventory-only |
| 866 | #20432 | `1b6ae0fe50ee41f1d7a8885625f1f18b9667e87e` | fix(combo): cap an explicit combo context_length at the executing model's window | inventory-only |
| 867 | #20431 | `cda04d03c80e2f774a26e41f59e72ff10ce63593` | fix(context): count every Responses input item at the final token gate | inventory-only |
| 868 | #20430 | `b685758ad70970a539536bf31549fc10802483a3` | fix(sse): stop re-serializing the request body for every streamed event | inventory-only |
| 869 | #20425 | `7ed02ef28ce0f08b2efca2cf8115ff28a3f14c32` | feat(cli): free encrypted remote config sync via GitHub or rclone | inventory-only |
| 870 | #20420 | `f0b836910ca8d47bb8389e7b14aec099626ec56b` | fix(dashboard): show proxy log attempt rank and outcome | inventory-only |
| 871 | #20419 | `7cbb6c0c8bd57b60d68c02719c485726552dc46a` | fix(sse): detect finish_reason across all streamed choices | inventory-only |
| 872 | #20417 | `deea9206ac2b4bf7f9fdcdb851e361a0b7b54c39` | fix(sse): scope cached reasoning to the provider and model that stored it | inventory-only |
| 873 | #20416 | `8f22eab18b25ac9e68c9810c987b2140e6720d86` | fix(sse): stop retrying non-transient thrown errors | inventory-only |
| 874 | #20414 | `11ed8faf6bf02fe379734f42012478c47c89156f` | fix(sse): do not enforce placeholder context limit for uncataloged passthrough models | inventory-only |
| 875 | #20413 | `fc6b57df9c9cf0f342d6621b1876e1d9c995e5b1` | fix(taskfitness): match wildcard boosts at model id segment boundaries | inventory-only |
| 876 | #20412 | `05219b989ccb1059626ff40e2fc236cf0a05dc68` | fix(sse): stop stored specificity from outranking specific wildcard aliases | inventory-only |
| 877 | #20410 | `fee3b416c11c2c6cfa60645718cb451321491a3a` | fix(db): index agentic_conversations by (fingerprint_hash, last_seen_at) so conversation tracking stops stalling the event loop | inventory-only |
| 878 | #20409 | `8afc0c464bfab93c2f9876cbbe5fde9c116ae5a1` | fix(combo): record per-target decisions in the round-robin leg | inventory-only |
| 879 | #20407 | `046ef3c12b55dd170e7ab2db9663eb36de75a841` | fix(oauth): recheck stale Codex quota before terminal rejection | inventory-only |
| 880 | #20403 | `56db790bda86ba8848bedd032ec2c09c3b6f509a` | feat(quota): read the SenseNova Token Plan balance through a refreshed console session | earlier-head-only + 1073-nov22-deferred-02.md |
| 881 | #20402 | `684c2513f178e760dc319ba7067bba1bd1dce9d8` | fix(embeddings): preserve nvidia/ namespace on uncurated model IDs (#20387) | inventory-only |
| 882 | #20396 | `26b800fa301c6ee560fd9790e8502a42b58263fb` | fix(streaming): preserve the end of replies with usage metadata | inventory-only |
| 883 | #20388 | `614e0bf15e99df4f728de073cf4a5214ff43d186` | fix(command-code): route /messages-only Claude models to /messages | inventory-only |
| 884 | #20383 | `378f95183293dbf3ad17e391d1725ecaee53a8e4` | deps: bump node from 26.12.1-trixie-slim to 26.13.0-trixie-slim | earlier-head-only + 1073-nov21-open-ledger-a.md |
| 885 | #20381 | `8ed08429a4534ccdcbcd3f74601547639e194edf` | feat(observability): opt-in repeated-400 advisory scan | inventory-only |
| 886 | #20379 | `830ac2ed61fe3707f080e490824f48ff9a8bfc52` | feat(claude): opt-in per-session caps for the signed-thinking replay store | inventory-only |
| 887 | #20378 | `5260e5fdfcef03378b3823e4d7341d0a92170c18` | feat(quota): opt-in release of a stale exhausted quota sample with no reset | inventory-only |
| 888 | #20375 | `7b78d1c5db38f2572ce25dda1a9bfae850a7c028` | fix(providers): rebuild chatplayground for the unified web chat API | inventory-only |
| 889 | #20374 | `58084a98bd43aeb4341e09f957bc635351242b90` | feat(combo): opt-in provider index for the model-lockout scan | inventory-only |
| 890 | #20368 | `d6cf6205430093129f96f6e9784321ba9070575c` | feat(grok): bulk import Grok CLI accounts | inventory-only |
| 891 | #20367 | `e868e3dbc621ad3cf33240ef9cdd6a8b5226155d` | chore(plugin): align SDK with host and verify compatibility across versions | inventory-only |
| 892 | #20366 | `60ab951517cdd1375c5d4d68310d68f9e5a9d621` | feat(plugin): hide routing entries when routers is false | inventory-only |
| 893 | #20365 | `44d320a69f579fe82da8ddd66bc0edc753f50a26` | feat(plugin-v2): publish computed capability fields in the stable catalog | inventory-only |
| 894 | #20362 | `b6d999fb9665206ac64d4a7290ae750cf3aa9177` | fix(codex): sync models for imported Codex accounts | inventory-only |
| 895 | #20353 | `193444ba2fe1f8fc5533cab9e6f2b184d5e4d87a` | feat(usage): opt-in resumable repricing job for never-priced cost-ledger rows | inventory-only |
| 896 | #20352 | `c250f8e35a149259875b40622c6f5f2ddd6e3739` | feat(auth): opt-in shorter dashboard session lifetime via DASHBOARD_SESSION_MAX_AGE_HOURS | inventory-only |
| 897 | #20349 | `64157cb7c61449d7484f74cd7f52f841858625d1` | feat(rate-limit): opt-in Groq token-window tracking via x-ratelimit headers | inventory-only |
| 898 | #20345 | `bede9e1dd556754eda1f6f1e3a030c6d84794285` | fix(sse): forward anthropic-ratelimit-* on non-streaming /v1/messages under the per-key policy | inventory-only |
| 899 | #20343 | `bbf27eea5c2957319eb67e598b98b0b45da4a525` | fix(sse): lock only the model on Cloudflare Workers AI paid-plan 403 (5035) | inventory-only |
| 900 | #20342 | `4580fae6966f26a069ff1eaf9f29b413acd4740b` | feat(antigravity): opt-in reasoning_effort tier selection | inventory-only |
| 901 | #20337 | `b221b866fef8c54e25206834a82c6df8359a6f80` | fix(executors): report the body that was sent last after a recovery retry | inventory-only |
| 902 | #20336 | `8d7d7d8e39099d714d7ee21355ecb03b0eac97b7` | fix(combo): finish the decision trace when the combo throws | inventory-only |
| 903 | #20335 | `6728995f8efd730fa9f89efa6292b88372085bc0` | fix(tools): let operators extend the Claude custom-tool-type reject list | inventory-only |
| 904 | #20330 | `e6b799a3783963a15a8b89e183aea7be85319b57` | feat(api): add no-log toggles at global, connection, and per-model levels | inventory-only |
| 905 | #20328 | `711fadde23d00e9a81302f7518dc4495a1f76beb` | feat(oauth): keep when a Claude login ends (refresh_token_expires_in) | inventory-only |
| 906 | #20327 | `d10e0eef5386e97eeb47c7e831710059cfbf400f` | feat(dashboard): per-connection transport selector for codex and qoder | inventory-only |
| 907 | #20325 | `feb6b6b4646574e4cf6101ad9df88351a136cdc7` | feat(sse): add an opt-in tui transport for the agy CLI | inventory-only |
| 908 | #20315 | `4cb1b748ef3ccb345aba12ac8a0dc44e7de7f6ad` | feat(antigravity): opt-in agy ACP transport with prompt cloaking | inventory-only |
| 909 | #20309 | `96bd90e6f6cf95a53ad7fd20ec02959fcaa23597` | feat(dashboard): hide Antigravity quota groups per account | inventory-only |
| 910 | #20308 | `e630afe31810c119c5b3faab0725316f5b2e34ae` | fix(routing): retain discovered Claude versions across refresh failures | inventory-only |
| 911 | #20307 | `cbf209db66db8e868cff76cdc3fcb602d80640b0` | fix(routing): refresh expired OpenAI client version caches | inventory-only |
| 912 | #20306 | `961b0b28bd20075b8ac5e3367db2f175b023ace6` | fix(routing): discover current Antigravity IDE releases | inventory-only |
| 913 | #20305 | `a8a0cdf6792895aa6a0ee593406f38991cac6ce1` | fix(routing): preserve Claude session affinity during auto-combo selection | inventory-only |
| 914 | #20298 | `83dcb446aab4700089b1e2a86353f07d26beb5e1` | fix(plugin): label custom-adapter models from the provider node name | inventory-only |
| 915 | #20296 | `f5515666c4f8cf9c545a96881c3b95ba8ee4e643` | feat(auth): accept OIDC access tokens for inference API | inventory-only |
| 916 | #20287 | `8179d4b7403729b83618a1684b7fbf78902b3579` | fix(resilience): default CREDENTIAL_GATE_AUTH_DIAGNOSES_ONLY to true (#20256) | inventory-only |
| 917 | #20280 | `4214dfc16cbdec56a531cd813ab33c0e7e899fb9` | fix(streaming): recognize CRLF frames during stream recovery | inventory-only |
| 918 | #20266 | `81553ef33984dca4d10c0492cae3d8fdfde26e4a` | fix(sse): rotate Codex ChatGPT-account unsupported models instead of stopping | inventory-only |
| 919 | #20239 | `7b633a62f79f823f86330c1ae6c50c0276e3bc9f` | fix(claude): key the OAuth identity cache by connection, not access token | inventory-only |
| 920 | #20237 | `4f4b9fefe356b2d2e1fe3fd35dbed987edcd66c5` | feat(chat): opt-in request guards (forced tool, duplicate model, tool-call observe, zstd, 2 more) | inventory-only |
| 921 | #20236 | `f5dcdfe98c70c099fdba33d9fbdae1ae9e074da6` | feat(observability): opt-in Prometheus metrics, empty-200 failover, batched usage and 3 more | inventory-only |
| 922 | #20235 | `716e3218b8f3465fda83d05ef0276eba5598e79a` | feat(guardrails): opt-in response sanitizer, exact-value denylist, classifier and 1 more | inventory-only |
| 923 | #20233 | `51a63520fce4b5e3b0fc6669233a4f38969a69f9` | fix(sse): no unrequested usage chunk, refused reply not a success, Retry-After dates and 4 more | inventory-only |
| 924 | #20232 | `a106c8a3e54a6be2eada368ede562bf758b91237` | fix(usage): bill the served model, no TTFT for non-streaming, Responses EOF and 6 more | inventory-only |
| 925 | #20230 | `d9f27e52dfe8c767941e7ffa56d2f6d104040d93` | fix(codex): drop reasoning ciphertext when a request rotates to another account | inventory-only |
| 926 | #20228 | `2dcfd06f008a7b0893e5195e86ef33bbfabaa26a` | fix(providers): MITM stream response, session id billing line, readiness degraded checks and 2 more | inventory-only |
| 927 | #20222 | `6477f77e18da42f576039ca7ead7ce756705fff6` | fix(translator): Claude to OpenAI streams, Responses field mapping and CLOVA errors | inventory-only |
| 928 | #20210 | `b3fc2ce4b32fd0450b6a2b502a90785d7588ffd4` | fix(cursor): preserve standard speed for Grok 4.7 effort aliases | inventory-only |
| 929 | #20209 | `27dcf6219201d668541bed97a836263a9da4bff4` | feat(model-scoring): add OpenRouter API, working taskFit, add auto/agentic combo | inventory-only |
| 930 | #20205 | `9bd71009484bd31fe7ecf92cb75d6c05c111ad10` | fix(gemini): schema keywords, tuple types, dropped request fields and 3 more | inventory-only |
| 931 | #20203 | `af3581303152027bc1074b37a48fd044b9832590` | fix(responses): 6 Chat to Responses stream fixes and early-keepalive backpressure | inventory-only |
| 932 | #20196 | `9ae2d486ddd80a6dad8a1e8a249ccc9a40c7c9f5` | fix(sse): key-health attribution, start-timeout clamp, request keys and 4 more | inventory-only |
| 933 | #20193 | `4be002a5987fb45760dec5de1c1e090bc75a4976` | fix(dashboard): refresh provider quota countdown on click | inventory-only |
| 934 | #20190 | `432ff5b04ccdd59512705a44899e3fa53d72d7f6` | fix(sse): token clamp by model, cache write snapshot, pending-row release and 4 more | inventory-only |
| 935 | #20189 | `e1e6905b854e6afb07e4d802b5e91d6a28abb911` | fix(sse): normalize required counters in final Responses usage | inventory-only |
| 936 | #20186 | `adb82ae9e28480b74b91cf22937476421c9c8cc4` | feat(plugins): add family alias ask gate | inventory-only |
| 937 | #20185 | `2648e39604e72a44435dd07a28efbf42bbdd193a` | fix(sse): honor xhigh direct response-start budget | inventory-only |
| 938 | #20175 | `c000c9f8cf65f859455f0e95b50d22b55cd805e4` | fix(sse): skip local context-window hard reject for unsourced 128k fallback (#19882) | inventory-only |
| 939 | #20172 | `a1c15fa288858415cb22bfacce52fdabddef1908` | fix(sse): preserve completed function_call status in Responses passthrough backfill (#20066) | inventory-only |
| 940 | #20168 | `4f0af1345e7c3c308dd00bbdd70dcc552e96e6db` | fix(usage): price per-key USD limit windows per request, not on summed tokens | inventory-only |
| 941 | #20165 | `946d066de6310067d8d4d0024754b46cc4c07bed` | fix(backend): download the aarch64 CLIProxyAPI asset on ARM64 hosts | inventory-only |
| 942 | #20164 | `de46a1da40dc3dd0030c0ae82d43e74310b2710b` | feat(sse): TokenHarbor quotas on the Provider Limits page | inventory-only |
| 943 | #20159 | `f0c3c7efda0c5c45357fe71afd9f9c56bd74bc54` | fix(sse): pin new sessions to the account the strategy picks | inventory-only |
| 944 | #20151 | `fb546be1b9aed298088183bb5f290e42858caab5` | fix(antigravity): report the live CLI version and survive an unreachable release feed | inventory-only |
| 945 | #20150 | `d87f268985efc21d970233d67d3e0a4d30846211` | fix(sse): preserve Dots numeric values and tool-local schemas | inventory-only |
| 946 | #20149 | `617724e055433aa5d05200d32ab4a03ef392ab54` | fix(sse): preserve delayed tool names in stream summaries | inventory-only |
| 947 | #20148 | `25b80c1535353118efff13308c23aec915052f29` | chore(deps): bump docker/login-action from 4.7.0 to 4.8.0 | earlier-head-only + 1073-nov21-open-ledger-a.md |
| 948 | #20146 | `1db1a99d6ac53517cafe9aa4a90a11c064e9d0a4` | fix(resilience): ignore nonpositive numeric Retry-After values | inventory-only |
| 949 | #20145 | `6d6aa982c24bdd857391736bef9057f8c0dc83f4` | fix(resilience): keep an upstream Retry-After hint to the millisecond | inventory-only |
| 950 | #20129 | `3f03f54f222fa1597c67ca47a33f5b4843a299d7` | fix: keep a long Claude session from stopping mid-turn | inventory-only |
| 951 | #20123 | `da9dc4675397eb627ad6903d0939d9d8de284a4d` | feat(family-alias-v2): exact-family aliases with an ask gate | inventory-only |
| 952 | #20107 | `a9a5ca6ca4a4cd8f56c31d7929210ae3945b980c` | feat(observability): export breaker, provider stats, budget time zone (6 features) | inventory-only |
| 953 | #20105 | `2629c15bc67537abcc25d5031150b7dbc76b11a9` | feat(cli-tools): safer Codex catalog and config writes, backup and restore (8 features) | inventory-only |
| 954 | #20104 | `ce3b6d2441d6b2e9c85dc50e88e1495e89954eae` | feat(routing): opt-in request shaping for Claude, Gemini and streaming (8 features) | inventory-only |
| 955 | #20103 | `f86e7cab9978aacc4f33005534a43b5509798c8f` | feat(providers): Bedrock IAM keys, Vertex embeddings, ElevenLabs Scribe and more (8 features) | inventory-only |
| 956 | #20100 | `8e841a874a8502dfaaed0df9a77afe2bb091f579` | feat(accounts): opt-in account selection, quota and rate-limit controls (8 features) | inventory-only |
| 957 | #20099 | `3c19ac3b32d4a8e8079c805916336691fbb56fb2` | feat(combos): opt-in routing and combo controls (7 features) | inventory-only |
| 958 | #20093 | `1c922b444a67e34af7c501e49d767cbe3e084edf` | fix(sse): move an Antigravity 503 to another account instead of waiting on the same one | inventory-only |
| 959 | #20090 | `669bddd039c1fde1b7f9d8c78aeec26d9e07becd` | fix(providers): consolidate Kimi API identity | inventory-only |
| 960 | #20085 | `a87f9e9f82042ebe7afcfb335f0cc688518dd627` | fix(routing): surface Nadir's 402/401 reason, back off 5 min on account errors, disclose keyed-decision fee | inventory-only |
| 961 | #20082 | `4a3087d4d91b99a9605e5d47d773e07a7fabf7db` | fix(arena): fall back to HF /rows when /filter is rate-limited | inventory-only |
| 962 | #20079 | `0af385833e5cfbcd8555d41b0132164d60492aa1` | feat(gemini): native Gemini Decision 1 endpoint with account fallback | inventory-only |
| 963 | #20076 | `90d322991b8eb12c6d1b6d2124ce39d844fd5348` | feat(combos): enhance dynamic account visibility and step editing in combo builder | inventory-only |
| 964 | #20074 | `05a2198b9e56fb4ec6ddcbd27dfd08c06cf15273` | fix(combo): wait for account capacity in flat routing | inventory-only |
| 965 | #20072 | `d60f07884480afdfde7a9fff0c288735eeff0673` | fix(oauth): clear cooldown together with its evidence on re-auth (#20067) | inventory-only |
| 966 | #20069 | `83d4a979c25927ba77c1951f057ba43297a76859` | fix(dashboard): roll compact counts over to the next unit at the rounding edge | inventory-only |
| 967 | #20065 | `bd44bf4c121fe9f6533d518bcbc7dcddd3564423` | fix(dashboard): flag built-in models missing from an authoritative live catalog | inventory-only |
| 968 | #20064 | `83289b164a3a859ec991db8f9cef6f701e8ad1eb` | fix(memory): keep tool_use and tool_result adjacent in cache-safe injection | inventory-only |
| 969 | #20063 | `6f15d43f25a282a0b805f65d2b0ebd582a3de35c` | fix(sse): escalate thinking-signature recovery on foreign-signed tool cycles | inventory-only |
| 970 | #20062 | `9d17eedd7980e7441f4c15af88d8ecfc9fdaeb9b` | fix(security): reject non-token upstream header names on write and read | inventory-only |
| 971 | #20019 | `c72d3395a936e33efa0b7d86d4f3f3ca48d2bd6d` | fix(cli): let setup-opencode's requested router override a stale omniroute provider baseURL | inventory-only |
| 972 | #20001 | `b3ecd5ce9ccc1ffc53b97fc7f5314a1ceb381094` | fix(sse): inline remote image URLs for Antigravity instead of sending image/* fileData | inventory-only |
| 973 | #19981 | `b56e04dddfcf066a80d1c477f2a3d484f66eceee` | fix(cli): write OpenCode reasoning variants and expose supported_reasoning_levels in /v1/models | inventory-only |
| 974 | #19980 | `c6627af7e3af8a35b6066b7577fa48ed5a279abf` | fix(sse): fail over on Claude 'out of extra usage' 400 instead of treating it as request-scoped | inventory-only |
| 975 | #19972 | `45a251c0560d2c0be2424781f1c6da34159c3d74` | fix(sse): scope a bare Cursor empty turn to the model, not the provider breaker | inventory-only |
| 976 | #19964 | `31399cee037cd30563898d23df6ab011b01b667f` | feat(providers): query Muse Code console quota windows | inventory-only |
| 977 | #19963 | `9fde1a33b125443df74017485844f71ae0307884` | fix(api): distinguish provider access refusal from invalid key in key validation | inventory-only |
| 978 | #19961 | `6472e89f720a778aa1ada1fa819b2d0b1925c74a` | fix(ui-kit): bare Checkbox gets a label wrapper so custom layouts stay clickable | inventory-only |
| 979 | #19940 | `e846876ccb575d4e11f0af8fab8aaa1c5b98f009` | fix(gemini): retain stable Flash free-tier models in free-only imports | inventory-only |
| 980 | #19893 | `ae193457fb805f14f98c0f778bb30d488ad41f73` | feat(routing): native dependency-free Laya opt-in router | inventory-only |
| 981 | #19880 | `63a41f1cea006c604462ca54af6be2ab0665fbfc` | feat(dashboard): add a Task-Aware Routing card to the Global Routing settings | inventory-only |
| 982 | #19879 | `8fe5ffa0b2b412521a0b33d82f295fa0ad3b4ca2` | feat(sse): escalate hard agent prompts to a stronger model in task-aware routing | inventory-only |
| 983 | #19878 | `6b2ffa5aca0712472db662c044b25b6d1c929abe` | fix(providers): add Gemini 4 Carbon discovery filter, tiers and plan-aware routing | inventory-only |
| 984 | #19877 | `46614c11b2a9dbc81f38e3fff614ed87d88a1e16` | fix(antigravity): back off a failed client-version lookup instead of retrying per request | inventory-only |
| 985 | #19874 | `61ed3381edffc7dec5fd1328ec866733984214c1` | fix(responses): prune expired pending continuations before reporting count | inventory-only |
| 986 | #19862 | `38cbf64e1ba5be909162f770c5f78159ef7f5b14` | fix(thinking): AUTO budget mode keeps explicit opt-outs; reasoning_effort none -> thinking disabled on Claude | inventory-only |
| 987 | #19850 | `2cb35eaa2fec984abf2cf02e88383f23c2dbb3f2` | fix(providers): register Claude Fable 5.2 metadata and pricing | inventory-only |
| 988 | #19847 | `8f5d830e1bc7339ca6ad956a9e6d3c7b58cfbb65` | Update image source in README.md | earlier-head-only + 1073-nov21-open-ledger-a.md |
| 989 | #19837 | `c650d93d73b0b7723d52153b78ffdc16876ae8b9` | feat(providers): accept Nous Portal live free models in free-only import (#19562) | inventory-only |
| 990 | #19830 | `f1838b947e75b2892ead11f582f54daed8a5ea03` | fix(settings): keep a __proto__ row as an own settings key | inventory-only |
| 991 | #19826 | `3cec02d3e6f038e28cc294d3613bdd2235de3ffa` | fix(authz): match IPv6 in the IP allow/deny list | inventory-only |
| 992 | #19803 | `49de79d2ac3f20e4478e3c3b95ab1b758ce8e148` | fix(cache): preserve cache context and compression integrity | inventory-only |
| 993 | #19800 | `ab57cc955c63def6d6a16d5973571ac3752c32ac` | feat(provider): add LunaRoute API key support | inventory-only |
| 994 | #19772 | `b0d6b2127f761d617f3f6517d8d38b15742ee820` | fix(api): declare the filtered body's content-length on provider models (#17196) | inventory-only |
| 995 | #19770 | `56f0aca0089187ea4a34b06941ba98a89019a726` | feat(providers): add Infomaniak AI Tools | inventory-only |
| 996 | #19764 | `9ecd013d3498696722d1b080f0bb0bfaaac632ce` | fix: CLI, scripts and config: 5 fixes | inventory-only |
| 997 | #19762 | `0d9219e62f55e5f69e7709a53664bd780c4ec49b` | feat(executors): add per-connection opt-out for the json_schema fallback | inventory-only |
| 998 | #19758 | `e8f40f4a3cb08ea19a4ef593f3f7a75ddf946ffa` | fix(call-logs): verify the artifact checksum when a call-log detail is read | inventory-only |
| 999 | #19756 | `8f9aef7bfa0cc20385a35750f539170af53d176e` | fix(quota): hold a per-key rpm slot from admission until the call ends | inventory-only |
| 1000 | #19753 | `107ab0f38356acf966744096684ebd7c429318e7` | feat(usage): split the analytics cost into billed and estimated parts | inventory-only |
| 1001 | #19752 | `64aaa952d15948f1389bcacede9a93a866f0cd72` | fix(combo): preserve quota-weighted circuit-open exclusions | inventory-only |
| 1002 | #19751 | `51f967c18733ccead18a08fc1efe6e6dba17daa4` | fix(audio): route the Hugging Face TTS catalog models to a provider that serves them | inventory-only |
| 1003 | #19742 | `6cadabf01fd7830c0a1e3f9ae9fd8f9a62e4bb23` | feat(antigravity): operator override for advertised client version | inventory-only |
| 1004 | #19729 | `c6af992ef32814497305dc57535647bc0e00e4db` | fix: src/lib modules: 4 fixes | inventory-only |
| 1005 | #19725 | `7845c4d3ea28ee8f9b8d37c564d10b9dc5a3baa8` | fix: plugins: 2 fixes | inventory-only |
| 1006 | #19723 | `4f71d4929d61030ba84a5d0408e37c4bc2702ec3` | fix: executors: 5 fixes | inventory-only |
| 1007 | #19721 | `8ee662de4d0db5fa92bb6b21f41dcef36df482da` | fix: request auth and routing: 5 fixes | inventory-only |
| 1008 | #19720 | `9844337c9ca67d12924e7bbc510be76370bc2a54` | fix: usage and call logs: 4 fixes | inventory-only |
| 1009 | #19718 | `a10c3375a7e4bb75dd794b436b67eaf623c676c2` | fix: usage and call logs: 4 fixes | inventory-only |
| 1010 | #19714 | `ca2a1a8e2808f6979a31464ac296a7b70578aac4` | fix: API routes: 5 fixes | inventory-only |
| 1011 | #19713 | `45937d8cd82a4ed2bafbcdd4f5b55c16ffaf8584` | fix: stream utils: 5 fixes | inventory-only |
| 1012 | #19703 | `1921bb66531f8ddb1e22f33a6d103a0a7d4b3865` | fix: stream utils: 5 fixes | inventory-only |
| 1013 | #19691 | `f406aa023444dd77ea7f6c99073f9c4ec9b42368` | fix(usage): separate provider-window API value from key budget accounting | inventory-only |
| 1014 | #19689 | `a6a72995faadeb9dfa01c1204cfc36fd3e4b09ab` | fix: database: 5 fixes | inventory-only |
| 1015 | #19688 | `db14f746407c263d3eac0183bf79ae523f55afba` | fix: open-sse services: 6 fixes | inventory-only |
| 1016 | #19687 | `d446d9b74346cb2176233174096d44b29857c7fe` | fix: open-sse services: 6 fixes | inventory-only |
| 1017 | #19682 | `c733dd76211edd02896c6587787b6ccdae98f622` | feat(search): add DeepSeek web search and fetch | inventory-only |
| 1018 | #19677 | `a64fcc7e3d41614263c6bfad831a5d3004ea48bc` | feat(routing): separate fresh-session admission from sticky reuse capacity | inventory-only |
| 1019 | #19664 | `f565ca9425f27b99e55c82a2aa3b6718fe5a718d` | fix(dashboard): use fresh quota observations and mark reset-window fill unknown | inventory-only |
| 1020 | #19639 | `91d93fdc03245bad80c5a3ecb06a5c804bda0dc8` | fix(providers): probe the saved base URL when validating Google PSE | inventory-only |
| 1021 | #19632 | `8d12181b119c911e8eaeab54c268cb157df83314` | fix: resilience env override warning, admission rejection key usage, hot-reload debounce, self-hosted backoff cap | inventory-only |
| 1022 | #19629 | `5a809f6201dfdb1112d60e1bbeaa94874c28d2cd` | fix(sse): service fixes: unmatched 4xx cooldown, Copilot version cache, provider profile memo, video response cap | inventory-only |
| 1023 | #19627 | `477a26e3c99205f5e5dc434af21c06a50d750b6b` | fix(sse): translator fixes: NVIDIA reasoning alias, OpenCode Go deepseek response_format, unique tool output_index | inventory-only |
| 1024 | #19626 | `b010ff8099dc7e111c6b54f963a62a02aea4a332` | fix(kiro): one Kiro IDE identity for every Kiro request; keep the version gate recoverable | inventory-only |
| 1025 | #19621 | `5f16d358dea7d57067d5be717fa5ca4312ae776b` | fix(providers): support Google Antigravity age-verification challenges and target unlock button | inventory-only |
| 1026 | #19602 | `156bff4649ef4bb812813b7661d83b586ae1db05` | fix(antigravity): update CLI fallback version to 1.5.3 | inventory-only |
| 1027 | #19584 | `54783a014a8e113b04497d6aa5519426e6279472` | fix(usage): request Cortecs reranking costs directly in USD | inventory-only |
| 1028 | #19549 | `5636cf37c12660a14f85f5d733f0a8bc89ab25af` | fix(settings): keep the model catalog cache when learned rate limits persist | inventory-only |
| 1029 | #19513 | `f4b53810ca7fb56f5e9a9ae2ba981da13afee450` | feat(resilience): add default and adaptive connection concurrency | inventory-only |
| 1030 | #19477 | `0e2bae2518a9eb74e34bd5739d98e166d52bce68` | feat(catalog): advertise per-model reasoning metadata in the codex-registry shape | inventory-only |
| 1031 | #19307 | `5b82500091e0ce3171cf6cec2f7020551703e3f1` | fix(zcode): restore official Start and Individual subscription accounts | inventory-only |
| 1032 | #19306 | `4afb0ca62e19eb94155c5b9c2b78bf4b91ae1dee` | feat(dashboard): display request payload size in request logger details | inventory-only |
| 1033 | #19305 | `1f33f0e10883549e4374ac38d47e87c94936bc5c` | feat(dashboard): show actual OpenAI costs without double counting | inventory-only |
| 1034 | #19288 | `45adb4f0235f2f1c0973500d5f8c4630039ec524` | feat(dashboard): add searchable combo and entity selectors | inventory-only |
| 1035 | #19287 | `00d427686677666195e5bec829e49da4fafdd17d` | feat(sse): route xAI video input to the edits and extensions endpoints | inventory-only |
| 1036 | #19261 | `5f1dd348f829e190489f7e8bb947109f378187e6` | feat(providers): add JZS Token OpenAI-compatible gateway | inventory-only |
| 1037 | #19256 | `6fabea8b1734010ca51aad456689310b7afbaefa` | feat(providers): add JembatanAI OpenAI-compatible gateway | inventory-only |
| 1038 | #19238 | `85c512b3004e861e449b1662fcb3e39d912dbb33` | feat(providers): add Pareto Inference | inventory-only |
| 1039 | #19167 | `5a3523ee5d9dc3a3fe610ed93b4c5ccb048bbca0` | feat(images): expose opt-in Codex quota snapshots from successful images | inventory-only |
| 1040 | #19149 | `ce0f2e3b64d51c480eccfd4c21b4ebeeaa0c2a0b` | feat(dashboard): allow multiple quota provider filters | inventory-only |
| 1041 | #18877 | `a84c6b43236f48a637d01cc15b5d2bfeecf0c7f2` | feat(providers): add fal.ai OpenRouter router as a first-class provider | inventory-only |
| 1042 | #18786 | `267b99c512dbac09b2fe8876c9a9ec9b7913ab9f` | feat(audio): add Azure Speech text-to-speech provider | inventory-only |
| 1043 | #18779 | `2db2aacc6d6f094159b6d195bc522d819e562012` | feat(ui): add Codex collection views and account action menus | inventory-only |
| 1044 | #18737 | `68cf0df31246015e2b33caa70a72cc1808f471e8` | feat(oauth): add native Qoder device flow sign-in | inventory-only |
| 1045 | #18673 | `521202400f67bf704d59d94ebe45548a29cc2eb5` | feat(adapta): expose all permitted text models from Adapta catalog | inventory-only |
| 1046 | #18668 | `ee2ee2bffd1766b82b76db28663b5237dc186017` | fix(resilience): unroll retry recursion, guard stack limits and apply… | inventory-only |
| 1047 | #18641 | `3cd98e667ae99e4ef8e9084adf318605284ff27f` | fix(api): resolve OpenCode Go pricing attribution | inventory-only |
| 1048 | #18631 | `b4c81c43ab34e725d9473882f72c0195a57f858b` | feat(dashboard): opt-in quota window and expiring reset credit alerts | inventory-only |
| 1049 | #18591 | `729a993de8e674542ae2faa7a5506eaa075e8df6` | feat(dashboard): add the Grok Bot console | earlier-head-only + 1073-nov22-verify-or02.md |
| 1050 | #18587 | `ce43a725ca9e43375f7bd44dcd5fa9568cf58e9c` | feat(oauth): add Devin Auth email+password sign-in for devin-desktop | inventory-only |
| 1051 | #18562 | `3459a98049c722789b764f51862964b73b4c6bc3` | fix(sse): frame late Chat Completions errors | inventory-only |
| 1052 | #18551 | `be28b2f4df97483112595236e4cdc4d24f9cded1` | feat(api-manager): manage per-key token quotas from the dashboard | inventory-only |
| 1053 | #18537 | `bff9e7bfab4ebd2877fa59195e810bd3dc254f10` | feat(providers): add LLMTR OpenAI-compatible gateway | inventory-only |
| 1054 | #18463 | `9214eff8b51079ea28d14f087290b376c7ed15f1` | feat(providers): add Obscurify.ai as an OpenAI-compatible API-key provider | inventory-only |
| 1055 | #18408 | `5b94470ade0aaec8394756a64d266505f8645e36` | feat(providers): add cheapaimodel as an OpenAI-compatible gateway | inventory-only |
| 1056 | #18399 | `a2206355a5da2f13f260c9adf2b3daf5b76395bd` | feat(routing): add offline TypeSafe shadow recommendations | inventory-only |
| 1057 | #18397 | `a88348060dc102ccebe2f3777e34099b2b08aa2b` | feat(opencode-plugin): headers option for header-based auth proxies (CF Access) | inventory-only |
| 1058 | #18395 | `7a6357915bdc72e6121ac3b5cdf5abe47c0407a6` | feat(providers): add connection model_map and notes with dual model usage tracking | inventory-only |
| 1059 | #18365 | `137056ba8fc56ee6a7b7f579beefc34bec7169f0` | feat(providers): add EVREN (SSYZ) OpenAI-compatible LLM provider | inventory-only |
| 1060 | #18325 | `c58554da587c97c2a995a2da26eeb381f63628b8` | feat(providers): add native Google Flow Web provider (Veo video/image generation, quotas, web-session) | inventory-only |
| 1061 | #18313 | `02472bb355bb92df4d74b1d2bbec513896757cb9` | feat(sse): emulate tool calling for the Cloudflare Playground provider | inventory-only |
| 1062 | #18054 | `a7279cfd3741d428db914570bcf0780d343ff154` | fix(auth): persist dashboard session revocation across refresh and concurrent logout | inventory-only |
| 1063 | #17964 | `9181f51c9cb126581e597a1ea3855c2050a957dd` | fix(chatgpt-web): isolate native runtime discovery and support bounded client tools | inventory-only |
| 1064 | #17403 | `aa02e3006f71221d9de0409c89457ef97d36bc20` | feat(search): add DeepSeek standalone Search and Fetch APIs | inventory-only |
| 1065 | #17055 | `daa239452dddf01242c98b9f9e8773ae14fb0f37` | feat(sse): keep one model per conversation in task-aware routing | inventory-only |
| 1066 | #16114 | `abceb1c3f6813b046e4ff3225b573683fd9fe6a7` | feat(providers): add Atlas Cloud as an OpenAI-compatible gateway | inventory-only |
| 1067 | #15983 | `e1aec62c1dcd8a61524c1021f8dd18794fe700e8` | feat(mcp): add opt-in native sidecar with legacy compatibility | inventory-only |
| 1068 | #15907 | `1cb525f426037d143c11eb7be308ecfa42c64912` | feat(dashboard): add model intelligence comparison panel | inventory-only |
| 1069 | #15554 | `f533309de865a671fe750c555e1fe9e9d9ff0d96` | feat(providers): add Gondola as an OpenAI-compatible provider | inventory-only |
| 1070 | #15410 | `8f1bf2325cc49c36e5089696de68fd9c56f2fa12` | feat(providers): add Ollama System One handler and decision-model discovery | inventory-only |
| 1071 | #15153 | `f1694f9b4141b088f052b5816d22cae8d29e3645` | feat(auth): add native Google and GitHub OAuth login for Dashboard | inventory-only |
| 1072 | #14863 | `009cc84a60dec564b1ee84cefebfad43464744ee` | feat(dashboard): API key details view and self-service quota settings | inventory-only |
| 1073 | #14667 | `8659558510a5799b16bd1ec03635dc561ee95912` | feat(api): list System One decision models on GET /v1/systemone/models | inventory-only |
| 1074 | #14308 | `831b95f28efc1be584a18d473ee03d0ea2471d20` | feat(providers): add Ashna, Atria, GapGPT and Hooshyar API-key providers (incl. Iran regional coverage) | inventory-only |
| 1075 | #13076 | `97210f0001cd5eaeb9e5cc1e8169aa128d90b572` | feat(nix): add lockfile-based package | inventory-only |
| 1076 | #12816 | `ff325268b4ccc122739e3ef175c9f4f3edc93a47` | feat(cli): add Oh My Pi (omp) CLI integration — setup-omp, run omp, configure omp | inventory-only |
