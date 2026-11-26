# 9router ledger E closure

Scope: provider catalogs, authentication, sign-in, connections and transport. Later dispositions apply to the same PR; where the head changed, the later head is identified below. The original ledger remains unchanged.

| Report | Row / PR | Old status | Final status | Evidence |
| --- | --- | --- | --- | --- |
| [ledger E](1072-nov21-open-ledger-e.md) | [#4133](https://github.com/decolua/9router/pull/4133) | port candidate | superseded | [1072-nov22-verify-9e00.md](1072-nov22-verify-9e00.md): already present; head `fc543af65c73` |
| [ledger E](1072-nov21-open-ledger-e.md) | [#4367](https://github.com/decolua/9router/pull/4367) | port candidate | out of scope: add Malay (ms) locale |  |
| [ledger E](1072-nov21-open-ledger-e.md) | [#4375](https://github.com/decolua/9router/pull/4375) | port candidate | out of scope: terminate OpenAI SSE with done sentinel |  |
| [ledger E](1072-nov21-open-ledger-e.md) | [#4378](https://github.com/decolua/9router/pull/4378) | port candidate | superseded | [1072-nov22-verify-9e00.md](1072-nov22-verify-9e00.md): ported; head `7f2a9a851de6` |
| [ledger E](1072-nov21-open-ledger-e.md) | [#4379](https://github.com/decolua/9router/pull/4379) | port candidate | out of scope: scope tool_call_id→name lookup to its own assistant turn |  |
| [ledger E](1072-nov21-open-ledger-e.md) | [#4380](https://github.com/decolua/9router/pull/4380) | port candidate | out of scope: populate output array in response.completed event |  |
| [ledger E](1072-nov21-open-ledger-e.md) | [#4382](https://github.com/decolua/9router/pull/4382) | port candidate | out of scope: rename tool parameter named 'properties' to avoid Gemini 400 |  |
| [ledger E](1072-nov21-open-ledger-e.md) | [#4388](https://github.com/decolua/9router/pull/4388) | port candidate | out of scope: reject disabled models at request time, not just in /v1/models listing |  |
| [ledger E](1072-nov21-open-ledger-e.md) | [#4400](https://github.com/decolua/9router/pull/4400) | port candidate | out of scope: stop writing the sk_9router placeholder as the API key |  |
| [ledger E](1072-nov21-open-ledger-e.md) | [#4403](https://github.com/decolua/9router/pull/4403) | port candidate | out of scope: keep every system message instead of only the last |  |
| [ledger E](1072-nov21-open-ledger-e.md) | [#4404](https://github.com/decolua/9router/pull/4404) | port candidate | out of scope: preserve native reasoning effort shape |  |
| [ledger E](1072-nov21-open-ledger-e.md) | [#4406](https://github.com/decolua/9router/pull/4406) | port candidate | out of scope: write a 9Router model catalog when applying Codex settings |  |
| [ledger E](1072-nov21-open-ledger-e.md) | [#4460](https://github.com/decolua/9router/pull/4460) | port candidate | superseded | [1072-nov22-verify-9e01.md](1072-nov22-verify-9e01.md): superseded; head `50a13c468d53` |
| [ledger E](1072-nov21-open-ledger-e.md) | [#4469](https://github.com/decolua/9router/pull/4469) | port candidate | superseded | [1072-nov22-verify-9e01.md](1072-nov22-verify-9e01.md): ported; head `e64937885bff` |
| [ledger E](1072-nov21-open-ledger-e.md) | [#4484](https://github.com/decolua/9router/pull/4484) | port candidate | out of scope: make the client context margin configurable (USAGE_BUFFER_TOKENS) |  |
| [ledger E](1072-nov21-open-ledger-e.md) | [#4491](https://github.com/decolua/9router/pull/4491) | port candidate | out of scope: headless in-container agents - dashboard + loop runner + GHCR CI |  |
| [ledger E](1072-nov21-open-ledger-e.md) | [#4499](https://github.com/decolua/9router/pull/4499) | port candidate | out of scope: emit status on translated output items |  |
| [ledger E](1072-nov21-open-ledger-e.md) | [#4533](https://github.com/decolua/9router/pull/4533) | port candidate | out of scope: honor explicit max_tokens/max_completion_tokens caps |  |
| [ledger E](1072-nov21-open-ledger-e.md) | [#4536](https://github.com/decolua/9router/pull/4536) | port candidate | out of scope: preserve reasoning_tokens through pivots and JSON converter |  |
| [ledger E](1072-nov21-open-ledger-e.md) | [#4574](https://github.com/decolua/9router/pull/4574) | port candidate | out of scope: retain Codex Responses cache and reasoning tokens |  |
| [ledger E](1072-nov21-open-ledger-e.md) | [#4575](https://github.com/decolua/9router/pull/4575) | port candidate | superseded | [1072-nov22-verify-9e02.md](1072-nov22-verify-9e02.md): ported; head `bee9a74fc3b4` |
| [ledger E](1072-nov21-open-ledger-e.md) | [#4577](https://github.com/decolua/9router/pull/4577) | port candidate | out of scope: preserve tool choice none in both directions |  |
| [ledger E](1072-nov21-open-ledger-e.md) | [#4582](https://github.com/decolua/9router/pull/4582) | port candidate | superseded | [1072-nov22-verify-9e02.md](1072-nov22-verify-9e02.md): ported; head `72d22468c844` |
| [ledger E](1072-nov21-open-ledger-e.md) | [#4587](https://github.com/decolua/9router/pull/4587) | port candidate | superseded | [1072-nov22-verify-9e02.md](1072-nov22-verify-9e02.md): ported; head `af3cbc9921fe` |
| [ledger E](1072-nov21-open-ledger-e.md) | [#4591](https://github.com/decolua/9router/pull/4591) | port candidate | out of scope: allow authenticated same-origin tunnel toggles |  |
| [ledger E](1072-nov21-open-ledger-e.md) | [#4594](https://github.com/decolua/9router/pull/4594) | port candidate | superseded | [1072-nov22-verify-9e03.md](1072-nov22-verify-9e03.md): ported; head `6dd9dbb66fd7` |
| [ledger E](1072-nov21-open-ledger-e.md) | [#4608](https://github.com/decolua/9router/pull/4608) | port candidate | out of scope: retain developer role for OpenAI |  |
| [ledger E](1072-nov21-open-ledger-e.md) | [#4616](https://github.com/decolua/9router/pull/4616) | port candidate | out of scope: return Message JSON for non-streaming retries |  |
| [ledger E](1072-nov21-open-ledger-e.md) | [#4617](https://github.com/decolua/9router/pull/4617) | port candidate | out of scope: honor custom vision toggle in routing and /v1/models |  |
| [ledger E](1072-nov21-open-ledger-e.md) | [#4623](https://github.com/decolua/9router/pull/4623) | port candidate | out of scope: instant failover and dynamic health-aware floating for locked models |  |
| [ledger E](1072-nov21-open-ledger-e.md) | [#4667](https://github.com/decolua/9router/pull/4667) | port candidate | out of scope: Fix structured outputs for Antigravity and forced function calls for Codex |  |
| [ledger E](1072-nov21-open-ledger-e.md) | [#4702](https://github.com/decolua/9router/pull/4702) | port candidate | out of scope: declare hosted web_search when history has web_search_call |  |
| [ledger E](1072-nov21-open-ledger-e.md) | [#4709](https://github.com/decolua/9router/pull/4709) | port candidate | superseded | [1072-nov22-port-4709.md](1072-nov22-port-4709.md): ported; head `f267d97535c2` |
| [ledger E](1072-nov21-open-ledger-e.md) | [#4710](https://github.com/decolua/9router/pull/4710) | port candidate | superseded | [1072-nov22-verify-9e04.md](1072-nov22-verify-9e04.md): ported; head `cb74d54c4ba0` |
| [ledger E](1072-nov21-open-ledger-e.md) | [#4723](https://github.com/decolua/9router/pull/4723) | port candidate | superseded | [1072-nov22-verify-9e04.md](1072-nov22-verify-9e04.md): not applicable; head `880137732fe4` |
| [ledger E](1072-nov21-open-ledger-e.md) | [#4724](https://github.com/decolua/9router/pull/4724) | port candidate | superseded | [1072-nov22-verify-9e04.md](1072-nov22-verify-9e04.md): ported; head `24ff275d6657` |
| [ledger E](1072-nov21-open-ledger-e.md) | [#4725](https://github.com/decolua/9router/pull/4725) | port candidate | out of scope: resolve undefined existingProvider in Pi settings POST |  |
| [ledger E](1072-nov21-open-ledger-e.md) | [#4747](https://github.com/decolua/9router/pull/4747) | port candidate | out of scope: add Vazirmatn font support for Persian and RTL locales |  |
| [ledger E](1072-nov21-open-ledger-e.md) | [#4748](https://github.com/decolua/9router/pull/4748) | port candidate | out of scope: add missing Persian translations and unify fallback pool text node |  |
| [ledger E](1072-nov21-open-ledger-e.md) | [#4749](https://github.com/decolua/9router/pull/4749) | port candidate | out of scope: only mark fetched connections as loading in quota tracker auto-refresh |  |
| [ledger E](1072-nov21-open-ledger-e.md) | [#4772](https://github.com/decolua/9router/pull/4772) | port candidate | out of scope: stop double-counting Claude cache tokens in stream usage |  |
| [ledger E](1072-nov21-open-ledger-e.md) | [#4866](https://github.com/decolua/9router/pull/4866) | port candidate | out of scope: Allow configuring Codex image Responses models |  |
| [ledger E](1072-nov21-open-ledger-e.md) | [#4874](https://github.com/decolua/9router/pull/4874) | port candidate | superseded | [1072-nov22-verify-9e05.md](1072-nov22-verify-9e05.md): ported; head `c054de8afdae` |
| [ledger E](1072-nov21-open-ledger-e.md) | [#4876](https://github.com/decolua/9router/pull/4876) | port candidate | superseded | [1072-nov22-verify-9e05.md](1072-nov22-verify-9e05.md): ported; head `b5098765ce6f` |
| [ledger E](1072-nov21-open-ledger-e.md) | [#4880](https://github.com/decolua/9router/pull/4880) | port candidate | out of scope: treat a 2xx with no usable content as a seat failure |  |
| [ledger E](1072-nov21-open-ledger-e.md) | [#4881](https://github.com/decolua/9router/pull/4881) | port candidate | out of scope: make the reasoning-content injector idempotent across alias carriers |  |
| [ledger E](1072-nov21-open-ledger-e.md) | [#4889](https://github.com/decolua/9router/pull/4889) | port candidate | superseded | [1072-nov22-verify-9e05.md](1072-nov22-verify-9e05.md): not applicable; head `87dd1d056d49` |
| [ledger E](1072-nov21-open-ledger-e.md) | [#4920](https://github.com/decolua/9router/pull/4920) | port candidate | out of scope: drag-to-reorder providers in the Quota Tracker |  |
| [ledger E](1072-nov21-open-ledger-e.md) | [#4969](https://github.com/decolua/9router/pull/4969) | port candidate | superseded | [1072-nov22-verify-9e06.md](1072-nov22-verify-9e06.md): ported; head `db6a9d700d14` |
| [ledger E](1072-nov21-open-ledger-e.md) | [#4982](https://github.com/decolua/9router/pull/4982) | port candidate | out of scope: treat role "developer" as a system instruction for Gemini and Claude targets |  |
| [ledger E](1072-nov21-open-ledger-e.md) | [#5037](https://github.com/decolua/9router/pull/5037) | port candidate | out of scope: cache the conversation tail for 1h, not 5m |  |
| [ledger E](1072-nov21-open-ledger-e.md) | [#5050](https://github.com/decolua/9router/pull/5050) | port candidate | out of scope: keep cache counters in the usage sent to OpenAI clients |  |
| [ledger E](1072-nov21-open-ledger-e.md) | [#5058](https://github.com/decolua/9router/pull/5058) | port candidate | out of scope: stop the body-size estimate from overriding the provider's usage |  |
| [ledger E](1072-nov21-open-ledger-e.md) | [#5060](https://github.com/decolua/9router/pull/5060) | port candidate | out of scope: never write the sk_9router placeholder into Pi models.json |  |
| [ledger E](1072-nov21-open-ledger-e.md) | [#5084](https://github.com/decolua/9router/pull/5084) | port candidate | superseded | [1072-nov22-port-5084.md](1072-nov22-port-5084.md): ported; head `05b54a57d72c` |
| [ledger E](1072-nov21-open-ledger-e.md) | [#5092](https://github.com/decolua/9router/pull/5092) | port candidate | out of scope: an empty upstream stream ends with an in-band error, recorded as an error |  |
| [ledger E](1072-nov21-open-ledger-e.md) | [#5094](https://github.com/decolua/9router/pull/5094) | port candidate | out of scope: return non-streaming responses in the client's format for every provider |  |
| [ledger E](1072-nov21-open-ledger-e.md) | [#5095](https://github.com/decolua/9router/pull/5095) | port candidate | superseded | [1072-nov22-verify-9e07.md](1072-nov22-verify-9e07.md): already present; head `ea5adbb83e39` |
| [ledger E](1072-nov21-open-ledger-e.md) | [#5140](https://github.com/decolua/9router/pull/5140) | port candidate | superseded | [1072-nov22-verify-9e07.md](1072-nov22-verify-9e07.md): ported; head `a19d8f71d8b6` |
| [ledger E](1072-nov21-open-ledger-e.md) | [#5161](https://github.com/decolua/9router/pull/5161) | port candidate | superseded | [1072-nov22-verify-9e07.md](1072-nov22-verify-9e07.md): not applicable; head `884f5be9bf2d` |
| [ledger E](1072-nov21-open-ledger-e.md) | [#5199](https://github.com/decolua/9router/pull/5199) | port candidate | out of scope: show live Zed models in passthrough provider picker |  |
| [ledger E](1072-nov21-open-ledger-e.md) | [#5212](https://github.com/decolua/9router/pull/5212) | port candidate | superseded | [1072-nov22-port-5212.md](1072-nov22-port-5212.md): ported; head `0a223278bac5` |
| [ledger E](1072-nov21-open-ledger-e.md) | [#5251](https://github.com/decolua/9router/pull/5251) | port candidate | superseded | [1072-nov22-verify-9e07.md](1072-nov22-verify-9e07.md): already present; head `d4b2c9b189d4` |
| [ledger E](1072-nov21-open-ledger-e.md) | [#5290](https://github.com/decolua/9router/pull/5290) | port candidate | superseded | [1072-nov22-verify-9e07.md](1072-nov22-verify-9e07.md): not applicable; head `0c75621f84b7` |
| [ledger E](1072-nov21-open-ledger-e.md) | [#5292](https://github.com/decolua/9router/pull/5292) | port candidate | out of scope: stop double-folding Claude cache into prompt_tokens and preserve cached_tokens on OpenAI finish chunks |  |
| [ledger E](1072-nov21-open-ledger-e.md) | [#5293](https://github.com/decolua/9router/pull/5293) | port candidate | superseded | [1072-nov22-verify-9e08.md](1072-nov22-verify-9e08.md): not applicable; head `d43d1384fd3b` |
| [ledger E](1072-nov21-open-ledger-e.md) | [#5297](https://github.com/decolua/9router/pull/5297) | port candidate | superseded | [1072-nov22-verify-9e08.md](1072-nov22-verify-9e08.md): ported; head `7e68a006f0a8` |
| [ledger E](1072-nov21-open-ledger-e.md) | [#5310](https://github.com/decolua/9router/pull/5310) | port candidate | superseded | [1072-nov22-verify-9e08.md](1072-nov22-verify-9e08.md): already present; head `0006f719fc95` |
| [ledger E](1072-nov21-open-ledger-e.md) | [#5314](https://github.com/decolua/9router/pull/5314) | port candidate | out of scope: show cache-read tokens and hit rate in Recent Requests |  |
| [ledger E](1072-nov21-open-ledger-e.md) | [#5462](https://github.com/decolua/9router/pull/5462) | port candidate | superseded | [1072-nov22-port-5462.md](1072-nov22-port-5462.md): ported; head `e3539dd18c65` |
| [ledger E](1072-nov21-open-ledger-e.md) | [#5599](https://github.com/decolua/9router/pull/5599) | port candidate | out of scope: preserve keyword-named tool parameters |  |
| [ledger E](1072-nov21-open-ledger-e.md) | [#5607](https://github.com/decolua/9router/pull/5607) | port candidate | superseded | [1072-nov22-verify-9e08.md](1072-nov22-verify-9e08.md): ported; head `ce68ddd452b2` |
| [ledger E](1072-nov21-open-ledger-e.md) | [#5616](https://github.com/decolua/9router/pull/5616) | port candidate | out of scope: keep usage-only trailers on OpenAI passthrough so cache hits survive |  |
| [ledger E](1072-nov21-open-ledger-e.md) | [#5619](https://github.com/decolua/9router/pull/5619) | port candidate | superseded | [1072-nov22-verify-9e09.md](1072-nov22-verify-9e09.md): not applicable; head `852d81e8319e` |
| [ledger E](1072-nov21-open-ledger-e.md) | [#5620](https://github.com/decolua/9router/pull/5620) | port candidate | superseded | [1072-nov22-verify-9e09.md](1072-nov22-verify-9e09.md): not applicable; head `57ca33aeccd7` |
| [ledger E](1072-nov21-open-ledger-e.md) | [#5626](https://github.com/decolua/9router/pull/5626) | port candidate | superseded | [1072-nov22-verify-9e09.md](1072-nov22-verify-9e09.md): not applicable; head `b0c0f64c346e` |
| [ledger E](1072-nov21-open-ledger-e.md) | [#5633](https://github.com/decolua/9router/pull/5633) | port candidate | out of scope: stop the settings page hydration mismatch for non-English users |  |
| [ledger E](1072-nov21-open-ledger-e.md) | [#5636](https://github.com/decolua/9router/pull/5636) | port candidate | out of scope: keep tool calls and developer turns intact across formats |  |
| [ledger E](1072-nov21-open-ledger-e.md) | [#5642](https://github.com/decolua/9router/pull/5642) | port candidate | superseded | [1072-nov22-verify-9e09.md](1072-nov22-verify-9e09.md): already present; head `c9e9f97429e1` |
| [ledger E](1072-nov21-open-ledger-e.md) | [#5656](https://github.com/decolua/9router/pull/5656) | port candidate | out of scope: per-API-key usage limits (cost/tokens per day/week/month) |  |
| [ledger E](1072-nov21-open-ledger-e.md) | [#5724](https://github.com/decolua/9router/pull/5724) | port candidate | superseded | [1072-nov22-verify-9e10.md](1072-nov22-verify-9e10.md): not applicable; head `f6ff2ef18a43` |
