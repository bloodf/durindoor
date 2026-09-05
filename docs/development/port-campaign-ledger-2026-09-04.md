# Port Campaign Disposition Ledger — 2026-09-04

Canonical disposition ledger for [#749](https://github.com/bloodf/durindoor/issues/749), its [#735](https://github.com/bloodf/durindoor/issues/735) upstream scan, and [#767](https://github.com/bloodf/durindoor/issues/767) provider audit. It supplements the [final campaign execution plan](port-campaign-2026-09-04.md), already merged to `main`. Evidence base: `6505912f5b9b91c21309479f037f3b271b5fb599`.

## Scope and status

- **Snapshot:** states and delivery outcomes below were refreshed from live GitHub at **2026-09-05T02:03:24Z**. They record that instant, not a promise about later merge or closure state; GitHub remains authoritative.
- **34 original campaign issues:** #735 and #737–#769 are retained below. #735 is the parent audit/reconciliation record, not a claim that 734 upstream rows were implemented.
- **Authorization:** maintainer waived issue-requested human pauses and authorized automatically reviewed green serial merges. Authentication, credential handling, SSRF, dual-auth, secret-export, and live-verification requirements were not waived.
- **Operational boundary:** no authenticated provider calls, credential inspection, production mutation, deployment, or service restart occurred. Rows requiring authenticated proof remain blocked, even where public endpoint evidence exists.
- **Provider count:** 120 disposition rows, exactly once in [provider matrix](#provider-coverage-matrix-120-rows). Reconciliation can close audit #767; it does not claim those providers shipped.
- **Parent scan count:** 734 scan IDs: 26 selected scan IDs map to 28 child issues because #3772 and #3694 each split into two issues; 708 scan IDs remain unselected. Every scan ID appears exactly once in [scan appendix](#parent-735-scan-reconciliation-734-rows).
- **Icon policy:** policy approved: identification-only, unchanged marks, source attribution, third-party rights retained, no endorsement, documented removal path. MIT does not grant rights to third-party marks; no permission, fair-use, or other legal conclusion is asserted.
- **Primary-checkout recovery:** during campaign, subagent edits leaked into seven previously clean primary-checkout files; complete diff and copies were archived under `/tmp/durindoor-20260904-campaign/primary-recovery`, only campaign-owned leaks were restored, initially staged `.omp` agents plus user `UsageTable` and settings-route edits were preserved, and subsequent status matched initial dirty state. Primary original state was restored; no production files or data were touched.

## Selected issue map

| Ledger ID | Issue | Upstream/theme | Current disposition | Evidence / remaining requirement |
| --- | ---: | --- | --- | --- |
|  | [#735](https://github.com/bloodf/durindoor/issues/735) | 734-row scan audit | reconciliation complete / ledger closure pending | Parent audit only: all 734 scan IDs are retained below as 26 selected and 708 unselected. This does not claim 734 implementations. Ledger PR may close the audit after gates and merge. |
| A11 | [#737](https://github.com/bloodf/durindoor/issues/737) | #3779 | merged | Delivered by merged [PR #771](https://github.com/bloodf/durindoor/pull/771). |
| A12 | [#738](https://github.com/bloodf/durindoor/issues/738) | #3770 | merged | Delivered by merged [PR #772](https://github.com/bloodf/durindoor/pull/772). |
| A13 | [#739](https://github.com/bloodf/durindoor/issues/739) | #3745 | merged | Delivered by merged [PR #775](https://github.com/bloodf/durindoor/pull/775). |
| A1 | [#740](https://github.com/bloodf/durindoor/issues/740) | #3785 | pending merge | Corrected candidate is in open [PR #787](https://github.com/bloodf/durindoor/pull/787); no merged delivery claim. |
| A2 | [#741](https://github.com/bloodf/durindoor/issues/741) | #3783 | pending merge | Corrected candidate is in open [PR #788](https://github.com/bloodf/durindoor/pull/788); no merged delivery claim. |
| A3 | [#742](https://github.com/bloodf/durindoor/issues/742) | #3778 | merged | Delivered by merged [PR #776](https://github.com/bloodf/durindoor/pull/776). |
| A14 | [#743](https://github.com/bloodf/durindoor/issues/743) | #3703 | merged | Delivered by merged [PR #777](https://github.com/bloodf/durindoor/pull/777). |
| D4 | [#744](https://github.com/bloodf/durindoor/issues/744) | #3654 | merged | Delivered by merged [PR #779](https://github.com/bloodf/durindoor/pull/779). Selective transfer includes the UI-token prerequisite and secure DB export/import: shared dual-auth, bounded JSON, secret-free preview, credentials omitted by default, explicit acknowledged secret export, atomic validated import, and preservation of unrelated rows and omitted credentials. |
| A4 | [#745](https://github.com/bloodf/durindoor/issues/745) | #3765 | merged | Delivered by merged [PR #778](https://github.com/bloodf/durindoor/pull/778). |
| B1 | [#746](https://github.com/bloodf/durindoor/issues/746) | #3733 | pending merge | Corrected candidate is in open [PR #789](https://github.com/bloodf/durindoor/pull/789); no merged delivery claim. |
| D6 | [#747](https://github.com/bloodf/durindoor/issues/747) | #3748 | pending implementation delivery | Deferred D6 combo allow-list work remains unmerged. Raw API-key bulk export remains forbidden pending separate security review. |
| D5 | [#748](https://github.com/bloodf/durindoor/issues/748) | #3768 | pending implementation delivery | Deferred D5 combo weights and Antigravity catalog remain unmerged. Preserve `gemini-3.5-flash-low`; reject unrelated upstream hunks. |
|  | [#749](https://github.com/bloodf/durindoor/issues/749) | Ledger | pending ledger delivery | This canonical ledger may close #749 only after its own gate and merge. |
| B2 | [#750](https://github.com/bloodf/durindoor/issues/750) | #3771 | pending merge | Corrected candidate is in open [PR #790](https://github.com/bloodf/durindoor/pull/790); no merged delivery claim. |
| A5 | [#751](https://github.com/bloodf/durindoor/issues/751) | #3772a | merged | Delivered by merged [PR #780](https://github.com/bloodf/durindoor/pull/780). |
| A6 | [#752](https://github.com/bloodf/durindoor/issues/752) | #3772b | merged | Delivered by merged [PR #781](https://github.com/bloodf/durindoor/pull/781). |
| A15 | [#753](https://github.com/bloodf/durindoor/issues/753) | #3694-zen | merged | Delivered by merged [PR #782](https://github.com/bloodf/durindoor/pull/782). |
| A7 | [#754](https://github.com/bloodf/durindoor/issues/754) | #3781 | merged | Delivered by merged [PR #783](https://github.com/bloodf/durindoor/pull/783). |
| C1 | [#755](https://github.com/bloodf/durindoor/issues/755) | #3776 | open / blocked — live verification | Kiro runtime/API behavior needs authenticated live verification. |
| A8 | [#756](https://github.com/bloodf/durindoor/issues/756) | #3693 | pending merge | Corrected candidate is in open [PR #792](https://github.com/bloodf/durindoor/pull/792); no merged delivery claim. |
| A9 | [#757](https://github.com/bloodf/durindoor/issues/757) | #3751 | merged | Delivered by merged [PR #784](https://github.com/bloodf/durindoor/pull/784). |
| C2 | [#758](https://github.com/bloodf/durindoor/issues/758) | #3694-cc | open / blocked — live verification | CommandCode monthly-cap behavior needs authenticated live verification. |
| A10 | [#759](https://github.com/bloodf/durindoor/issues/759) | #3713 | merged | Delivered by merged [PR #785](https://github.com/bloodf/durindoor/pull/785). |
| D1 | [#760](https://github.com/bloodf/durindoor/issues/760) | #3661 | pending merge | Security-sensitive API-key provider-account scoping and migration are in open [PR #791](https://github.com/bloodf/durindoor/pull/791); no merged delivery claim. |
| D2 | [#761](https://github.com/bloodf/durindoor/issues/761) | #3754 | pending implementation delivery | Explicit combo capability caps remain unmerged. |
| D3 | [#762](https://github.com/bloodf/durindoor/issues/762) | #3663 | open / blocked — live verification | Alibaba Token Plan live catalog/media/thinking requires authenticated proof. |
| B3 | [#763](https://github.com/bloodf/durindoor/issues/763) | #3780 | open / blocked — correction and live verification | [PR #786](https://github.com/bloodf/durindoor/pull/786) is open. Public documentation identifies two contributor models and session header; acceptance still requires correction and authenticated evidence. |
| B6 | [#764](https://github.com/bloodf/durindoor/issues/764) | #3747 | pending correction | Candidate needs correction before acceptance; no merged delivery PR. |
| B4 | [#765](https://github.com/bloodf/durindoor/issues/765) | #3757 | open / blocked — live verification | Meta AI provider needs authenticated live verification. |
| B5 | [#766](https://github.com/bloodf/durindoor/issues/766) | #3655 | pending correction | Candidate needs correction before acceptance; no merged delivery PR. |
|  | [#767](https://github.com/bloodf/durindoor/issues/767) | OmniRoute audit | reconciliation complete / ledger closure pending | All 120 provider dispositions are reconciled below. Ledger PR may close this audit after gates and merge; closure means audit completion, not provider shipment. Separate merged [PR #774](https://github.com/bloodf/durindoor/pull/774) delivered Astra catalog configuration and implements no provider-audit row. Every `PORT-*` row remains blocked because authenticated evidence was not collected. |
|  | [#768](https://github.com/bloodf/durindoor/issues/768) | Sarvam | open / blocked — live verification | Sarvam requires authenticated chat round-trip and authenticated `/v1/models` fixture. |
|  | [#769](https://github.com/bloodf/durindoor/issues/769) | Trademark policy | policy merged / ledger closure pending | Policy source merged in [PR #773](https://github.com/bloodf/durindoor/pull/773), and exact-ID renderer triage is recorded below. #769 may close only after this ledger's own gate and merge; canonical-asset availability remains distinct from renderer results. |

Selected mapping is deliberately issue-level; it does not invent an implementation plan beyond issue acceptance contracts.

## Delivery outcomes

Live GitHub state snapshot: **2026-09-05T02:03:24Z**. PR bodies supply issue mappings through `Closes`; unknown mappings remain explicitly unclaimed. These links do not change 734-row scan dispositions or turn audit verdicts into implementation claims.

| PR | Campaign relationship | Snapshot state |
| ---: | --- | --- |
| [#770](https://github.com/bloodf/durindoor/pull/770) | Documentation gate-link prerequisite; body closes no campaign issue | merged |
| [#771](https://github.com/bloodf/durindoor/pull/771) | Closes [#737](https://github.com/bloodf/durindoor/issues/737) | merged |
| [#772](https://github.com/bloodf/durindoor/pull/772) | Closes [#738](https://github.com/bloodf/durindoor/issues/738) | merged |
| [#773](https://github.com/bloodf/durindoor/pull/773) | Policy source; body references #769, #735, #749, and #767 but closes none | merged |
| [#774](https://github.com/bloodf/durindoor/pull/774) | Separate Astra catalog delivery; body closes no campaign issue and implements no provider-audit row | merged |
| [#775](https://github.com/bloodf/durindoor/pull/775) | Closes [#739](https://github.com/bloodf/durindoor/issues/739) | merged |
| [#776](https://github.com/bloodf/durindoor/pull/776) | Closes [#742](https://github.com/bloodf/durindoor/issues/742) | merged |
| [#777](https://github.com/bloodf/durindoor/pull/777) | Closes [#743](https://github.com/bloodf/durindoor/issues/743) | merged |
| [#778](https://github.com/bloodf/durindoor/pull/778) | Closes [#745](https://github.com/bloodf/durindoor/issues/745) | merged |
| [#779](https://github.com/bloodf/durindoor/pull/779) | Closes [#744](https://github.com/bloodf/durindoor/issues/744) | merged |
| [#780](https://github.com/bloodf/durindoor/pull/780) | Closes [#751](https://github.com/bloodf/durindoor/issues/751) | merged |
| [#781](https://github.com/bloodf/durindoor/pull/781) | Closes [#752](https://github.com/bloodf/durindoor/issues/752) | merged |
| [#782](https://github.com/bloodf/durindoor/pull/782) | Closes [#753](https://github.com/bloodf/durindoor/issues/753) | merged |
| [#783](https://github.com/bloodf/durindoor/pull/783) | Closes [#754](https://github.com/bloodf/durindoor/issues/754) | merged |
| [#784](https://github.com/bloodf/durindoor/pull/784) | Closes [#757](https://github.com/bloodf/durindoor/issues/757) | merged |
| [#785](https://github.com/bloodf/durindoor/pull/785) | Closes [#759](https://github.com/bloodf/durindoor/issues/759) | merged |
| [#786](https://github.com/bloodf/durindoor/pull/786) | Closes [#763](https://github.com/bloodf/durindoor/issues/763) if merged; acceptance remains blocked | open |
| [#787](https://github.com/bloodf/durindoor/pull/787) | Closes [#740](https://github.com/bloodf/durindoor/issues/740) if merged | open |
| [#788](https://github.com/bloodf/durindoor/pull/788) | Closes [#741](https://github.com/bloodf/durindoor/issues/741) if merged | open |
| [#789](https://github.com/bloodf/durindoor/pull/789) | Closes [#746](https://github.com/bloodf/durindoor/issues/746) if merged | open |
| [#790](https://github.com/bloodf/durindoor/pull/790) | Closes [#750](https://github.com/bloodf/durindoor/issues/750) if merged | open |
| [#791](https://github.com/bloodf/durindoor/pull/791) | Closes [#760](https://github.com/bloodf/durindoor/issues/760) if merged | open |
| [#792](https://github.com/bloodf/durindoor/pull/792) | Closes [#756](https://github.com/bloodf/durindoor/issues/756) if merged | open |

No other implementation delivery is claimed at this snapshot. Remaining ordered migration work is #748 migration 015, #761 migration 016, then #747 migration 017; open #791 carries predecessor #760 migration 014.

## Local candidate evidence

Candidate evidence below is historical worktree evidence, not current delivery state. Delivery truth is recorded in the issue map and live PR table above. Audit labels mean only complete or correction-required review status; they do not override merged/open/pending outcomes. SHAs and branches are retained verbatim from `worktrees.json`.

| Issue | Audit result | Candidate commit | Branch |
| ---: | --- | --- | --- |
| #737 | complete | `8196198b044794a41d854fc3e5d45687ee81bf84` | `port/upstream-3779-kiro-dedupe` |
| #738 | complete | `cfe5726095e82f0f670b9e4c9e88d4eb7a04ba95` | `port/upstream-3770-provider-unconfigured` |
| #739 | complete | `e798afc10755a30b8e66d1c4e2cf4032d436a5ca` | `port/upstream-3745-proxy-log-level` |
| #740 | correction required | `31abcb8abb3564cf71d96903cc54b3a735704142` | `port/upstream-3785-reasoning-injector` |
| #741 | correction required | `2164457d0600fe011d78742e90b8e9d639386ef4` | `port/upstream-3783-mcp-ssrf` |
| #742 | complete | `9ad3c2056aea06acf6590618e6f52d6308205d3d` | `port/upstream-3778-codex-reset-credit` |
| #743 | complete | `c57a2c41cc1a7da8d572fd040fe27bdc85b5133b` | `port/upstream-3703-quota-cadence` |
| #745 | complete | `a69f4cb4425cfbd5f5342bcb9205356f530e0124` | `port/upstream-3765-toolcall-guards` |
| #746 | correction required | `fa2d16a691b7ef181e33d9c67fe4e2616d1cf0d5` | `port/upstream-3733-prompt-cache-key` |
| #750 | correction required | `810427c6f4e2fc547a1cf1e350dc44ae728556d7` | `port/upstream-3771-status-class` |
| #751 | complete | `7b88b9cae83f8e9168d80e648b962b920323c36b` | `port/upstream-3772-parallel-index` |
| #752 | complete | `cb537bdd23e5e7e44912c84ce4c7b47b071f688b` | `port/upstream-3772-media-placeholder` |
| #753 | complete | `c3e71487de4fe077d7aa02c6aefb3a6a9aa037ef` | `port/upstream-3694-zen-muse-routing` |
| #754 | complete | `43e35bc87c640530edc36ea049ad26c0687a2755` | `port/upstream-3781-finish-aliases` |
| #756 | correction required | `8d293752ff46d0e41926033b112a68c39f21d594` | `port/upstream-3693-model-echo` |
| #757 | complete | `0f0f77d66d07e7068d972038f77a913319413836` | `port/upstream-3751-fable-pricing` |
| #759 | complete | `060792a1f55b8700ff7632452540213932614cef` | `port/upstream-3713-blank-parts` |
| #763 | not accepted / separate blocker | `d1522303a3aa0eb8cdaa18852917d7579d48c600` | `port/upstream-3780-opencode-go-muse` |
| #764 | correction required | `564fb988136a4bd76730f0e79dd4ffb3f909d278` | `port/upstream-3747-compact-tokens` |
| #765 | not accepted / separate blocker | `7d98c7be5c86f8130a33ae0adae69750043ba11f` | `port/upstream-3757-meta-ai-BLOCKED` |
| #766 | correction required | `0983f5c917128f7be452fb3382d1db2daf480b21` | `port/upstream-3655-live-models-union` |


## Live-verification blockers

- **#755:** authenticated Kiro runtime surface and `REQUEST_BODY_INVALID` behavior required.
- **#758:** authenticated CommandCode quota/cap evidence required.
- **#762:** authenticated Alibaba Token Plan catalog and feature behavior required.
- **#765:** authenticated Meta AI routing/catalog evidence required.
- **#768:** required redacted fixture: real Sarvam chat round-trip plus authenticated `/v1/models`; anonymous catalog is not contract. `sarvam-30b` must not be advertised without authenticated proof. Trademark policy approved and no longer the gate.
- **#767 `PORT-*` rows:** campaign collected no authenticated provider evidence, so every `PORT-*` disposition remains blocked where its original criteria require that evidence. No fixture was fabricated and no static catalog is approved merely from OmniRoute.

Final blocker semantics at snapshot time: #755, #758, #762, #765, and #768 remain open and live-blocked. Open or unimplemented candidates remain pending, including #786–#792 and ordered #748/#761/#747 migrations. After main gates, this ledger PR may close parent audit #735, ledger issue #749, reconciled provider audit #767, and policy/triage issue #769; closure occurs only when the PR merges. These audit/document/policy closures do not claim remaining implementations delivered.

## Provider coverage matrix (120 rows)

Verdict totals: RISKY-deferred 43; REJECT 38; PORT-first-party 19; DUPLICATE 9; PORT-gateway 4; PORT-other 3; MEDIA-out-of-scope 3; PORT-other (folded) 1. Total **120**. Approved exclusions are retained: REJECT, MEDIA-out-of-scope, and RISKY-deferred rows are not implementation authorization. `PORT-*` expresses audit suitability, not completed routing. All `PORT-*` rows in this campaign requiring authenticated evidence remain blocked under campaign rules.

| ID | Alias | Provider | Verdict | Campaign disposition / evidence |
| --- | --- | --- | --- | --- |
| `agnes` | `agnes` | Agnes AI | **RISKY-deferred** | deferred per approved scope |
| `aihorde` | `horde` | AI Horde | **PORT-other** | blocked: authenticated provider verification forbidden by user; original criteria require evidence; volunteer compute; queue unstable; live discovery only |
| `ainative` | `ainative` | AINative Studio | **RISKY-deferred** | deferred per approved scope |
| `aion` | `aion` | Aion Labs | **PORT-first-party** | blocked: authenticated provider verification forbidden by user; original criteria require evidence |
| `ant-ling` | `ling` | Ant Ling / Ring (inclusionAI) | **RISKY-deferred** | deferred per approved scope |
| `anyapi` | `anyapi` | AnyAPI AI | **PORT-gateway** | blocked: authenticated provider verification forbidden by user; original criteria require evidence |
| `auriko` | `auriko` | Auriko | **RISKY-deferred** | deferred per approved scope |
| `blackbox-web` | `bb-web` | Blackbox Web (Subscription) | **RISKY-deferred** | deferred per approved scope |
| `chat-oripe` | `chat-oripe` | Chat Oripe | **REJECT** | excluded per approved scope |
| `chatanywhere` | `chatanywhere` | ChatAnywhere | **REJECT** | excluded per approved scope |
| `chatgpt-web-codex` | `cgpt-codex` | ChatGPT Web (Codex) | **REJECT** | excluded per approved scope |
| `cheaperinference` | `cinf` | Cheaper Inference | **RISKY-deferred** | deferred per approved scope |
| `claude-web` | `cw` | Claude Web | **RISKY-deferred** | deferred per approved scope |
| `cloudcode-one` | `cloudcode-one` | CloudCode.ONE | **REJECT** | excluded per approved scope |
| `cloudflare-playground` | `cfp` | Cloudflare AI Playground | **REJECT** | excluded per approved scope; requires browser/TLS impersonation to bypass auth |
| `clova-studio` | `clova` | Naver CLOVA Studio | **PORT-first-party** | blocked: authenticated provider verification forbidden by user; original criteria require evidence; needs native CLOVA translator, not OpenAI-compatible |
| `codex-app-server` | `cxa` | OpenAI Codex (App-Server) | **RISKY-deferred** | deferred per approved scope |
| `conol-web` | `cnl` | Conol (Unofficial/Experimental) | **REJECT** | excluded per approved scope |
| `coze` | `coze` | Coze | **RISKY-deferred** | deferred per approved scope |
| `cursor-api` | `cua` | Cursor API | **DUPLICATE** | blocked: authenticated provider verification forbidden by user; original criteria require evidence; → auth mode on `cursor` |
| `dahl` | `dahl` | Dahl | **RISKY-deferred** | deferred per approved scope |
| `deepai` | `deepai` | DeepAI | **MEDIA-out-of-scope** | excluded per approved scope |
| `deepseek-web` | `ds-web` | DeepSeek Web | **RISKY-deferred** | deferred per approved scope |
| `devin-cli-agentic` | `dva` | Devin CLI Agentic Bridge | **RISKY-deferred** | deferred per approved scope |
| `devin-desktop` | `—` | Devin Desktop | **RISKY-deferred** | deferred per approved scope |
| `doubao-web` | `db` | Dola Web (ByteDance) | **RISKY-deferred** | deferred per approved scope |
| `dxnt` | `dxnt` | DXNT / DX Token | **REJECT** | excluded per approved scope |
| `electronhub` | `electronhub` | Electron Hub | **RISKY-deferred** | deferred per approved scope |
| `fastrouter` | `fastrouter` | FastRouter | **PORT-gateway** | blocked: authenticated provider verification forbidden by user; original criteria require evidence |
| `free-ai` | `free-ai` | Free.ai | **REJECT** | excluded per approved scope |
| `freebuff` | `freebuff` | Freebuff | **REJECT** | excluded per approved scope |
| `freeinference` | `freeinference` | FreeInference | **REJECT** | excluded per approved scope |
| `freetheai` | `fta` | FreeTheAi | **REJECT** | excluded per approved scope |
| `g4f-gemini` | `g4fgem` | g4f.space — Gemini | **REJECT** | excluded per approved scope; gpt4free relay — unauthorised resale |
| `g4f-groq` | `g4fgroq` | g4f.space — Groq | **REJECT** | excluded per approved scope; gpt4free relay — unauthorised resale |
| `g4f-nvidia` | `g4fnv` | g4f.space — NVIDIA | **REJECT** | excluded per approved scope; gpt4free relay — unauthorised resale |
| `g4f-ollama` | `g4foll` | g4f.space — Ollama | **REJECT** | excluded per approved scope; gpt4free relay — unauthorised resale |
| `g4f-pollinations` | `g4fpol` | g4f.space — Pollinations | **REJECT** | excluded per approved scope; gpt4free relay — unauthorised resale |
| `gemini-business` | `gembiz` | Gemini Business (Enterprise) | **RISKY-deferred** | deferred per approved scope |
| `gemini-web` | `gweb` | Gemini Web (Free) | **RISKY-deferred** | deferred per approved scope |
| `ghe-copilot` | `ghe-copilot` | GitHub Enterprise Copilot | **RISKY-deferred** | deferred per approved scope |
| `helixmind` | `helixmind` | HelixMind | **REJECT** | excluded per approved scope |
| `helyxai` | `helyxai` | Helyx AI | **REJECT** | excluded per approved scope |
| `hyperagent` | `ha` | HyperAgent (Unofficial/Experimental) | **RISKY-deferred** | deferred per approved scope |
| `inception` | `inception` | Inception | **PORT-first-party** | blocked: authenticated provider verification forbidden by user; original criteria require evidence |
| `internlm` | `internlm` | InternLM (Intern-S1) | **PORT-first-party** | blocked: authenticated provider verification forbidden by user; original criteria require evidence |
| `literouter` | `literouter` | LiteRouter | **RISKY-deferred** | deferred per approved scope |
| `llm-kiwi` | `llmkiwi` | LLM.Kiwi | **RISKY-deferred** | deferred per approved scope |
| `llmgateway` | `llmgateway` | LLM Gateway | **PORT-gateway** | blocked: authenticated provider verification forbidden by user; original criteria require evidence |
| `lmarena` | `lma` | Arena (Free) | **RISKY-deferred** | deferred per approved scope |
| `logfare` | `logfare` | Logfare | **REJECT** | excluded per approved scope; ToS permits using prompts for private evaluation |
| `magnific` | `freepik` | Magnific | **MEDIA-out-of-scope** | excluded per approved scope |
| `maxai` | `mx` | MaxAI | **RISKY-deferred** | deferred per approved scope |
| `meganova-ai` | `meganova-ai` | MegaNova AI | **RISKY-deferred** | deferred per approved scope |
| `mixlayer` | `mixlayer` | Mixlayer | **RISKY-deferred** | deferred per approved scope |
| `mlx` | `—` | — | **REJECT** | excluded per approved scope; framework, not a routable provider |
| `mlx-gemma` | `mlx-gemma` | MLX Gemma 26B | **REJECT** | excluded per approved scope |
| `mlx-qwen` | `mlx-qwen` | MLX Qwen 3.8 27B | **REJECT** | excluded per approved scope |
| `mnn-ai` | `mnn-ai` | MNN AI | **REJECT** | excluded per approved scope |
| `modal` | `mdl` | Modal | **REJECT** | excluded per approved scope; infra platform, not a hosted Gemini endpoint |
| `modelscope` | `ms` | ModelScope | **PORT-first-party** | blocked: authenticated provider verification forbidden by user; original criteria require evidence |
| `monsterapi` | `monster` | MonsterAPI | **RISKY-deferred** | deferred per approved scope |
| `moonshot` | `moonshot` | Kimi | **DUPLICATE** | blocked: authenticated provider verification forbidden by user; original criteria require evidence; → update existing `kimi` |
| `muse-code` | `mc` | Muse Code (Meta) | **REJECT** | excluded per approved scope; no base URL at all in source |
| `naga-ac` | `naga` | Naga.ac | **RISKY-deferred** | deferred per approved scope |
| `naga-ai` | `naga-ai` | Naga AI | **REJECT** | excluded per approved scope; duplicate endpoint of naga-ac |
| `nanogpt` | `nanogpt` | NanoGPT | **RISKY-deferred** | deferred per approved scope |
| `nara` | `nara` | NaraRouter | **RISKY-deferred** | deferred per approved scope |
| `navy` | `navy` | NavyAI | **REJECT** | excluded per approved scope |
| `nlpcloud` | `nlpc` | NLP Cloud | **RISKY-deferred** | deferred per approved scope |
| `notion-web` | `nw` | Notion AI Web (Unofficial/Experimental) | **RISKY-deferred** | deferred per approved scope |
| `nous-research` | `nous` | Nous Research | **RISKY-deferred** | deferred per approved scope |
| `nscale` | `nscale` | nScale | **PORT-first-party** | blocked: authenticated provider verification forbidden by user; original criteria require evidence |
| `ofoxai` | `ofoxai` | OfoxAI | **RISKY-deferred** | deferred per approved scope |
| `ollama-cloud` | `ollamacloud` | Ollama Cloud | **DUPLICATE** | blocked: authenticated provider verification forbidden by user; original criteria require evidence; → update existing `ollama` |
| `oneminai` | `1min` | 1min.AI | **RISKY-deferred** | deferred per approved scope |
| `openadapter` | `oad` | OpenAdapter | **PORT-first-party** | blocked: authenticated provider verification forbidden by user; original criteria require evidence |
| `openference` | `of` | Openference | **PORT-other** | blocked: authenticated provider verification forbidden by user; original criteria require evidence; NEW provider. One service, two auth modes: OAuth (`of`) + API key (`ofa`). Port as a single provider carrying both; see `openference-api`. |
| `openference-api` | `ofa` | Openference API | **PORT-other (folded)** | blocked: authenticated provider verification forbidden by user; original criteria require evidence; Not a separate provider and NOT a DUPLICATE — DurinDoor has no Openference entry to update. Ships as the API-key auth mode inside the single `openference` provider. Counted once with it. |
| `openvecta` | `openvecta` | OpenVecta | **PORT-first-party** | blocked: authenticated provider verification forbidden by user; original criteria require evidence |
| `opper` | `opper` | Opper | **PORT-gateway** | blocked: authenticated provider verification forbidden by user; original criteria require evidence |
| `orcarouter` | `orcarouter` | OrcaRouter | **PORT-first-party** | blocked: authenticated provider verification forbidden by user; original criteria require evidence |
| `ovhcloud` | `ovh` | OVHcloud AI | **PORT-first-party** | blocked: authenticated provider verification forbidden by user; original criteria require evidence |
| `pioneer` | `pn` | Pioneer AI | **PORT-first-party** | blocked: authenticated provider verification forbidden by user; original criteria require evidence |
| `plamo` | `plamo` | PLaMo | **PORT-first-party** | blocked: authenticated provider verification forbidden by user; original criteria require evidence |
| `poixe-ai` | `poixe-ai` | Poixe AI | **RISKY-deferred** | deferred per approved scope |
| `predibase` | `predibase` | Predibase | **PORT-first-party** | blocked: authenticated provider verification forbidden by user; original criteria require evidence |
| `promptql` | `pql` | PromptQL (Unofficial/Experimental) | **REJECT** | excluded per approved scope |
| `publicai` | `publicai` | PublicAI | **RISKY-deferred** | deferred per approved scope |
| `qwen-cloud` | `qwc` | Qwen Cloud | **DUPLICATE** | blocked: authenticated provider verification forbidden by user; original criteria require evidence; → update existing `alibaba` |
| `qwen-cloud-token-plan` | `qct` | Qwen Cloud Token Plan | **DUPLICATE** | blocked: authenticated provider verification forbidden by user; original criteria require evidence; → update existing `alitp-intl` |
| `regolo` | `regolo` | Regolo AI | **PORT-first-party** | blocked: authenticated provider verification forbidden by user; original criteria require evidence; OmniRoute baseUrl is WRONG (missing /v1/chat/completions) |
| `routeway` | `routeway` | Routeway | **PORT-first-party** | blocked: authenticated provider verification forbidden by user; original criteria require evidence |
| `sarvam` | `sarvam` | Sarvam AI | **PORT-first-party** | blocked: authenticated provider verification forbidden by user; original criteria require evidence |
| `sealion` | `sealion` | SEA-LION | **PORT-first-party** | blocked: authenticated provider verification forbidden by user; original criteria require evidence |
| `seekai` | `ska` | SeekAi | **REJECT** | excluded per approved scope |
| `segmind` | `segmind` | Segmind | **MEDIA-out-of-scope** | excluded per approved scope |
| `speka` | `speka` | Speka AI | **RISKY-deferred** | deferred per approved scope |
| `tabitoken` | `tabitoken` | TabiToken | **REJECT** | excluded per approved scope |
| `tencent-aistudio-web` | `tasw` | Tencent AI Studio (Free) | **RISKY-deferred** | deferred per approved scope |
| `tinycms` | `—` | — | **REJECT** | excluded per approved scope; runtime id is tinycms-web; same unsafe gateway |
| `tinycms-web` | `tcw` | TinyCMS Web (Free/Sub) | **REJECT** | excluded per approved scope |
| `token-kiosk` | `tk` | Token Kiosk | **REJECT** | excluded per approved scope |
| `tokenreply` | `tokenreply` | TokenReply | **REJECT** | excluded per approved scope |
| `typhoon` | `typhoon` | Typhoon | **PORT-first-party** | blocked: authenticated provider verification forbidden by user; original criteria require evidence |
| `uc` | `ucn` | UC (uncensored.com) | **REJECT** | excluded per approved scope; private WebSocket + minted Clerk session |
| `uc-direct` | `ucd` | UC Direct (uncensored.com) | **DUPLICATE** | REJECT / deferred: original DUPLICATE is corrected; DurinDoor has no `uc-direct` target. Separate transport; ToS proof required before any future assessment.; no current fork target; private WebSocket and minted Clerk session risk |
| `unorouter` | `unorouter` | UnoRouter | **RISKY-deferred** | deferred per approved scope |
| `void-ai` | `void-ai` | Void AI | **RISKY-deferred** | deferred per approved scope |
| `volcengine-agent-plan` | `veap` | Volcengine Ark Agent Plan | **DUPLICATE** | blocked: authenticated provider verification forbidden by user; original criteria require evidence; → transport mode on `volcengine-ark` |
| `volcengine-coding-plan` | `vecp` | Volcengine Ark Coding Plan | **DUPLICATE** | blocked: authenticated provider verification forbidden by user; original criteria require evidence; → transport mode on `volcengine-ark` |
| `writer` | `writer` | Writer | **PORT-first-party** | blocked: authenticated provider verification forbidden by user; original criteria require evidence |
| `xai-oauth` | `xao` | xAI OAuth (Grok) | **REJECT** | excluded per approved scope; redundant: DurinDoor `xai` already does OAuth + API key, same token endpoint |
| `xiaomi-mimo-token-plan` | `mimotp` | Xiaomi MiMo Token Plan | **DUPLICATE** | blocked: authenticated provider verification forbidden by user; original criteria require evidence; → auth mode on `xiaomi-mimo` |
| `yolo-auto` | `yolo-auto` | Yolo-Auto | **REJECT** | excluded per approved scope |
| `zai-web` | `zw` | Z.ai Web | **RISKY-deferred** | deferred per approved scope |
| `zcode` | `zc` | ZCode (GLM Coding Plan) | **RISKY-deferred** | deferred per approved scope |
| `zed-hosted` | `—` | Zed Hosted Models | **PORT-other** | blocked: authenticated provider verification forbidden by user; original criteria require evidence; logo already at public/providers/zed-hosted.svg; registry entry missing |
| `zerolimitai` | `zerolimitai` | ZeroLimitAI | **REJECT** | excluded per approved scope |
| `zylo-api` | `zylo` | Zylo API | **RISKY-deferred** | deferred per approved scope |

Approved exclusions are retained: REJECT, MEDIA-out-of-scope, and RISKY-deferred rows are not implementation authorization. `PORT-*` expresses audit suitability, not completed routing. All `PORT-*` rows in this campaign requiring authenticated evidence remain blocked under campaign rules.

## Icon policy and #769 renderer triage

Policy approval applies to future asset decisions: assets are identification-only and unchanged; retain source attribution and third-party rights; do not imply endorsement; honor removal requests. It does not establish permission, fair use, or a right granted by the MIT license.

### Exact-ID `ProviderLogo` runtime proof — 2026-09-04

Two observed passes are recorded separately. Raw exact-ID pass (`icon-runtime-results.json`) rendered all 59 IDs in running Storybook: `mimocode` resolved through built-in alias `/providers/mimo-free.png`; remaining 58 rendered letter tiles. Canonical pass (`icon-canonical-runtime-results.json`) rendered all 17 queried canonical IDs. It proves reusable canonical assets exist; it does not mean their raw aliases render today.

### Complete 59-row classification

Exact-rendering totals: **1 resolves-via-alias**, **10 no-mark-applicable**, **48 genuinely missing rendering**. Canonical-asset availability among 48 runtime misses: **16 existing canonical assets (alias fix only)**; **32 absent reusable vendor marks**. No source aliases or assets changed: #769 criterion is truthful renderer triage, not bulk renderer or asset work.

| Exact ID | Exact-ID runtime (raw) | Exact-rendering classification | Canonical asset availability | Canonical mark / note |
| --- | --- | --- | --- | --- |
| `9router` | letter tile `9router` | **no-mark-applicable** | n/a | — |
| `agy` | letter tile `agy` | **genuinely-missing-rendering** | available — alias fix only | `antigravity` canonical asset verified |
| `ai21` | letter tile `ai21` | **genuinely-missing-rendering** | absent — no reusable vendor mark | — |
| `alibaba` | letter tile `alibaba` | **genuinely-missing-rendering** | available — alias fix only | `alibaba-cn` canonical asset verified |
| `alitp-intl` | letter tile `alitp-intl` | **genuinely-missing-rendering** | available — alias fix only | `alibaba-cn` canonical asset verified |
| `auto` | letter tile `auto` | **no-mark-applicable** | n/a | — |
| `bai` | letter tile `bai` | **genuinely-missing-rendering** | absent — no reusable vendor mark | — |
| `bailian-coding-plan` | letter tile `bailian-coding-plan` | **genuinely-missing-rendering** | available — alias fix only | `alibaba-cn` canonical asset verified |
| `baseten` | letter tile `baseten` | **genuinely-missing-rendering** | absent — no reusable vendor mark | — |
| `bedrock` | letter tile `bedrock` | **genuinely-missing-rendering** | absent — no reusable vendor mark | — |
| `bigmodel` | letter tile `bigmodel` | **genuinely-missing-rendering** | available — alias fix only | `glm-cn` canonical asset verified |
| `chenzk` | letter tile `chenzk` | **genuinely-missing-rendering** | absent — no reusable vendor mark | — |
| `codex-cloud` | letter tile `codex-cloud` | **genuinely-missing-rendering** | available — alias fix only | `codex` canonical asset verified |
| `copilot-m365-web` | letter tile `copilot-m365-web` | **genuinely-missing-rendering** | available — alias fix only | `copilot` canonical asset verified |
| `copilot-web` | letter tile `copilot-web` | **genuinely-missing-rendering** | available — alias fix only | `copilot` canonical asset verified |
| `databricks` | letter tile `databricks` | **genuinely-missing-rendering** | absent — no reusable vendor mark | — |
| `deepinfra` | letter tile `deepinfra` | **genuinely-missing-rendering** | absent — no reusable vendor mark | — |
| `devin` | letter tile `devin` | **genuinely-missing-rendering** | absent — no reusable vendor mark | — |
| `devin-cli` | letter tile `devin-cli` | **genuinely-missing-rendering** | absent — no reusable vendor mark | — |
| `featherless-ai` | letter tile `featherless-ai` | **genuinely-missing-rendering** | absent — no reusable vendor mark | — |
| `fish-audio` | letter tile `fish-audio` | **genuinely-missing-rendering** | absent — no reusable vendor mark | — |
| `friendliai` | letter tile `friendliai` | **genuinely-missing-rendering** | absent — no reusable vendor mark | — |
| `glhf` | letter tile `glhf` | **genuinely-missing-rendering** | absent — no reusable vendor mark | — |
| `grok-cli` | letter tile `grok-cli` | **genuinely-missing-rendering** | available — alias fix only | `grok-web` canonical asset verified |
| `inference-net` | letter tile `inference-net` | **genuinely-missing-rendering** | absent — no reusable vendor mark | — |
| `kimi-web` | letter tile `kimi-web` | **genuinely-missing-rendering** | available — alias fix only | `kimi` canonical asset verified |
| `lambda-ai` | letter tile `lambda-ai` | **genuinely-missing-rendering** | absent — no reusable vendor mark | — |
| `llama-cpp` | letter tile `llama-cpp` | **no-mark-applicable** | n/a | — |
| `lm-studio` | letter tile `lm-studio` | **no-mark-applicable** | n/a | — |
| `longcat` | letter tile `longcat` | **genuinely-missing-rendering** | absent — no reusable vendor mark | — |
| `meta-llama` | letter tile `meta-llama` | **genuinely-missing-rendering** | absent — no reusable vendor mark | — |
| `mimocode` | asset `/providers/mimo-free.png` rendered | **resolves-via-alias (raw)** | n/a — already resolved | `mimo-free` built-in alias rendered directly |
| `mmf` | letter tile `mmf` | **no-mark-applicable** | n/a | Hidden internal router/no distinct vendor mark |
| `morph` | letter tile `morph` | **genuinely-missing-rendering** | absent — no reusable vendor mark | — |
| `muse-spark-web` | letter tile `muse-spark-web` | **genuinely-missing-rendering** | absent — no reusable vendor mark | — |
| `novita` | letter tile `novita` | **genuinely-missing-rendering** | absent — no reusable vendor mark | — |
| `oobabooga` | letter tile `oobabooga` | **no-mark-applicable** | n/a | — |
| `omniroute-api-cloud` | letter tile `omniroute-api-cloud` | **no-mark-applicable** | n/a | — |
| `opencode-zen` | letter tile `opencode-zen` | **genuinely-missing-rendering** | available — alias fix only | `opencode` canonical asset verified |
| `perplexity-agent` | letter tile `perplexity-agent` | **genuinely-missing-rendering** | available — alias fix only | `perplexity` canonical asset verified |
| `pollinations` | letter tile `pollinations` | **genuinely-missing-rendering** | absent — no reusable vendor mark | — |
| `qoder-cn` | letter tile `qoder-cn` | **genuinely-missing-rendering** | available — alias fix only | `qoder` canonical asset verified |
| `sambanova` | letter tile `sambanova` | **genuinely-missing-rendering** | absent — no reusable vendor mark | — |
| `snowflake` | letter tile `snowflake` | **genuinely-missing-rendering** | absent — no reusable vendor mark | — |
| `suno` | letter tile `suno` | **genuinely-missing-rendering** | absent — no reusable vendor mark | — |
| `tinyfish` | letter tile `tinyfish` | **genuinely-missing-rendering** | absent — no reusable vendor mark | — |
| `trae` | letter tile `trae` | **genuinely-missing-rendering** | absent — no reusable vendor mark | — |
| `triton` | letter tile `triton` | **no-mark-applicable** | n/a | — |
| `udio` | letter tile `udio` | **genuinely-missing-rendering** | absent — no reusable vendor mark | — |
| `upstage` | letter tile `upstage` | **genuinely-missing-rendering** | absent — no reusable vendor mark | — |
| `v0-vercel` | letter tile `v0-vercel` | **genuinely-missing-rendering** | absent — no reusable vendor mark | — |
| `vercel-ai-gateway` | letter tile `vercel-ai-gateway` | **genuinely-missing-rendering** | absent — no reusable vendor mark | — |
| `venice` | letter tile `venice` | **genuinely-missing-rendering** | absent — no reusable vendor mark | — |
| `vllm` | letter tile `vllm` | **no-mark-applicable** | n/a | — |
| `volcengine` | letter tile `volcengine` | **genuinely-missing-rendering** | available — alias fix only | `volcengine-ark` canonical asset verified |
| `windsurf` | letter tile `windsurf` | **genuinely-missing-rendering** | absent — no reusable vendor mark | — |
| `xinference` | letter tile `xinference` | **no-mark-applicable** | n/a | — |
| `zai` | letter tile `zai` | **genuinely-missing-rendering** | available — alias fix only | `glm-cn` canonical asset verified |
| `zed` | letter tile `zed` | **genuinely-missing-rendering** | available — alias fix only | `zed-hosted` canonical asset verified |

## Astra disposition

Astra source configuration was delivered separately by merged [PR #774](https://github.com/bloodf/durindoor/pull/774); it does not implement or close any #767 provider-audit row. The merged implementation preserves provider-specific Codex limits and existing saved `connection.defaultModel` selections. Sources remain the OpenAI API docs and pinned Codex catalog captured for the campaign.

| Surface | Merged context and limits | Merged reasoning | Merged catalog behavior |
| --- | --- | --- | --- |
| OpenAI `gpt-6-astra` | context 1,050,000; max input 922,000; max output 128,000; text+image input, text output | low, medium, high, xhigh, max; `none` and `minimal` clamp to `low` | Built-in first/default OpenAI model using Responses format. Unsupported `temperature`, `top_p`, `top_logprobs`, Chat `logprobs`, and Responses output-text logprobs include are removed. API pricing includes a 272,000-token long-context threshold. |
| Codex / `cx` `gpt-6-astra` | default context 272,000; optional maximum 872,000 in pinned source; no published max input or max output | low, medium, high, xhigh, max, ultra; `none` and `minimal` clamp to `low`; omitted effort keeps effective `low` | Built-in first/default Codex model. Direct-API limits, search capability, max-output ceiling, and pricing override do not leak into Codex. Existing saved defaults remain unchanged. |

## Parent #735 scan reconciliation (734 rows)

The parent scan is reconciliation-only. Of 734 scan IDs, 26 selected scan IDs map to 28 child issues because #3772 maps to #751/#752 and #3694 maps to #753/#758; remaining 708 scan IDs are preserved as unselected, not claimed done. Selected mapping: #3785→#740, #3783→#741, #3781→#754, #3780→#763, #3779→#737, #3778→#742, #3776→#755, #3772→#751/#752, #3771→#750, #3770→#738, #3768→#748, #3765→#745, #3757→#765, #3754→#761, #3751→#757, #3748→#747, #3747→#764, #3745→#739, #3733→#746, #3713→#759, #3703→#743, #3694→#753/#758, #3663→#762, #3661→#760, #3655→#766, #3654→#744.

### Complete per-row appendix

| Upstream PR | Disposition |
| ---: | --- |
| #3793 | unselected parent scan row; preserved outside campaign implementation scope |
| #3792 | unselected parent scan row; preserved outside campaign implementation scope |
| #3791 | unselected parent scan row; preserved outside campaign implementation scope |
| #3790 | unselected parent scan row; preserved outside campaign implementation scope |
| #3785 | selected child issue; see issue mapping |
| #3783 | selected child issue; see issue mapping |
| #3781 | selected child issue; see issue mapping |
| #3780 | selected child issue; see issue mapping |
| #3779 | selected child issue; see issue mapping |
| #3778 | selected child issue; see issue mapping |
| #3776 | selected child issue; see issue mapping |
| #3773 | unselected parent scan row; preserved outside campaign implementation scope |
| #3772 | selected child issue; see issue mapping |
| #3771 | selected child issue; see issue mapping |
| #3770 | selected child issue; see issue mapping |
| #3768 | selected child issue; see issue mapping |
| #3767 | unselected parent scan row; preserved outside campaign implementation scope |
| #3766 | unselected parent scan row; preserved outside campaign implementation scope |
| #3765 | selected child issue; see issue mapping |
| #3757 | selected child issue; see issue mapping |
| #3754 | selected child issue; see issue mapping |
| #3751 | selected child issue; see issue mapping |
| #3748 | selected child issue; see issue mapping |
| #3747 | selected child issue; see issue mapping |
| #3746 | unselected parent scan row; preserved outside campaign implementation scope |
| #3745 | selected child issue; see issue mapping |
| #3733 | selected child issue; see issue mapping |
| #3713 | selected child issue; see issue mapping |
| #3705 | unselected parent scan row; preserved outside campaign implementation scope |
| #3703 | selected child issue; see issue mapping |
| #3694 | selected child issue; see issue mapping |
| #3683 | unselected parent scan row; preserved outside campaign implementation scope |
| #3663 | selected child issue; see issue mapping |
| #3661 | selected child issue; see issue mapping |
| #3659 | unselected parent scan row; preserved outside campaign implementation scope |
| #3657 | unselected parent scan row; preserved outside campaign implementation scope |
| #3655 | selected child issue; see issue mapping |
| #3654 | selected child issue; see issue mapping |

| #3650 | unselected parent scan row; preserved outside campaign implementation scope |
| #3645 | unselected parent scan row; preserved outside campaign implementation scope |
| #3643 | unselected parent scan row; preserved outside campaign implementation scope |
| #3638 | unselected parent scan row; preserved outside campaign implementation scope |
| #3635 | unselected parent scan row; preserved outside campaign implementation scope |
| #3632 | unselected parent scan row; preserved outside campaign implementation scope |
| #3631 | unselected parent scan row; preserved outside campaign implementation scope |
| #3630 | unselected parent scan row; preserved outside campaign implementation scope |
| #3625 | unselected parent scan row; preserved outside campaign implementation scope |
| #3618 | unselected parent scan row; preserved outside campaign implementation scope |
| #3616 | unselected parent scan row; preserved outside campaign implementation scope |
| #3614 | unselected parent scan row; preserved outside campaign implementation scope |
| #3613 | unselected parent scan row; preserved outside campaign implementation scope |
| #3608 | unselected parent scan row; preserved outside campaign implementation scope |
| #3607 | unselected parent scan row; preserved outside campaign implementation scope |
| #3604 | unselected parent scan row; preserved outside campaign implementation scope |
| #3599 | unselected parent scan row; preserved outside campaign implementation scope |
| #3592 | unselected parent scan row; preserved outside campaign implementation scope |
| #3584 | unselected parent scan row; preserved outside campaign implementation scope |
| #3582 | unselected parent scan row; preserved outside campaign implementation scope |
| #3575 | unselected parent scan row; preserved outside campaign implementation scope |
| #3551 | unselected parent scan row; preserved outside campaign implementation scope |
| #3546 | unselected parent scan row; preserved outside campaign implementation scope |
| #3544 | unselected parent scan row; preserved outside campaign implementation scope |
| #3541 | unselected parent scan row; preserved outside campaign implementation scope |
| #3540 | unselected parent scan row; preserved outside campaign implementation scope |
| #3539 | unselected parent scan row; preserved outside campaign implementation scope |
| #3537 | unselected parent scan row; preserved outside campaign implementation scope |
| #3534 | unselected parent scan row; preserved outside campaign implementation scope |
| #3531 | unselected parent scan row; preserved outside campaign implementation scope |
| #3530 | unselected parent scan row; preserved outside campaign implementation scope |
| #3528 | unselected parent scan row; preserved outside campaign implementation scope |
| #3526 | unselected parent scan row; preserved outside campaign implementation scope |
| #3525 | unselected parent scan row; preserved outside campaign implementation scope |
| #3520 | unselected parent scan row; preserved outside campaign implementation scope |
| #3512 | unselected parent scan row; preserved outside campaign implementation scope |
| #3511 | unselected parent scan row; preserved outside campaign implementation scope |
| #3507 | unselected parent scan row; preserved outside campaign implementation scope |
| #3504 | unselected parent scan row; preserved outside campaign implementation scope |
| #3502 | unselected parent scan row; preserved outside campaign implementation scope |
| #3495 | unselected parent scan row; preserved outside campaign implementation scope |
| #3487 | unselected parent scan row; preserved outside campaign implementation scope |
| #3485 | unselected parent scan row; preserved outside campaign implementation scope |
| #3476 | unselected parent scan row; preserved outside campaign implementation scope |
| #3471 | unselected parent scan row; preserved outside campaign implementation scope |
| #3460 | unselected parent scan row; preserved outside campaign implementation scope |
| #3453 | unselected parent scan row; preserved outside campaign implementation scope |
| #3445 | unselected parent scan row; preserved outside campaign implementation scope |
| #3428 | unselected parent scan row; preserved outside campaign implementation scope |
| #3408 | unselected parent scan row; preserved outside campaign implementation scope |
| #3403 | unselected parent scan row; preserved outside campaign implementation scope |
| #3394 | unselected parent scan row; preserved outside campaign implementation scope |
| #3387 | unselected parent scan row; preserved outside campaign implementation scope |
| #3380 | unselected parent scan row; preserved outside campaign implementation scope |
| #3376 | unselected parent scan row; preserved outside campaign implementation scope |
| #3367 | unselected parent scan row; preserved outside campaign implementation scope |
| #3364 | unselected parent scan row; preserved outside campaign implementation scope |
| #3363 | unselected parent scan row; preserved outside campaign implementation scope |
| #3361 | unselected parent scan row; preserved outside campaign implementation scope |
| #3359 | unselected parent scan row; preserved outside campaign implementation scope |
| #3357 | unselected parent scan row; preserved outside campaign implementation scope |
| #3349 | unselected parent scan row; preserved outside campaign implementation scope |
| #3348 | unselected parent scan row; preserved outside campaign implementation scope |
| #3347 | unselected parent scan row; preserved outside campaign implementation scope |
| #3346 | unselected parent scan row; preserved outside campaign implementation scope |
| #3345 | unselected parent scan row; preserved outside campaign implementation scope |
| #3337 | unselected parent scan row; preserved outside campaign implementation scope |
| #3330 | unselected parent scan row; preserved outside campaign implementation scope |
| #3329 | unselected parent scan row; preserved outside campaign implementation scope |
| #3328 | unselected parent scan row; preserved outside campaign implementation scope |
| #3325 | unselected parent scan row; preserved outside campaign implementation scope |
| #3321 | unselected parent scan row; preserved outside campaign implementation scope |
| #3320 | unselected parent scan row; preserved outside campaign implementation scope |
| #3319 | unselected parent scan row; preserved outside campaign implementation scope |
| #3318 | unselected parent scan row; preserved outside campaign implementation scope |
| #3317 | unselected parent scan row; preserved outside campaign implementation scope |
| #3316 | unselected parent scan row; preserved outside campaign implementation scope |
| #3315 | unselected parent scan row; preserved outside campaign implementation scope |
| #3314 | unselected parent scan row; preserved outside campaign implementation scope |
| #3311 | unselected parent scan row; preserved outside campaign implementation scope |
| #3301 | unselected parent scan row; preserved outside campaign implementation scope |
| #3297 | unselected parent scan row; preserved outside campaign implementation scope |
| #3295 | unselected parent scan row; preserved outside campaign implementation scope |
| #3291 | unselected parent scan row; preserved outside campaign implementation scope |
| #3284 | unselected parent scan row; preserved outside campaign implementation scope |
| #3276 | unselected parent scan row; preserved outside campaign implementation scope |
| #3273 | unselected parent scan row; preserved outside campaign implementation scope |
| #3272 | unselected parent scan row; preserved outside campaign implementation scope |
| #3265 | unselected parent scan row; preserved outside campaign implementation scope |
| #3261 | unselected parent scan row; preserved outside campaign implementation scope |
| #3259 | unselected parent scan row; preserved outside campaign implementation scope |
| #3258 | unselected parent scan row; preserved outside campaign implementation scope |
| #3257 | unselected parent scan row; preserved outside campaign implementation scope |
| #3255 | unselected parent scan row; preserved outside campaign implementation scope |
| #3252 | unselected parent scan row; preserved outside campaign implementation scope |
| #3238 | unselected parent scan row; preserved outside campaign implementation scope |
| #3231 | unselected parent scan row; preserved outside campaign implementation scope |
| #3222 | unselected parent scan row; preserved outside campaign implementation scope |
| #3220 | unselected parent scan row; preserved outside campaign implementation scope |
| #3219 | unselected parent scan row; preserved outside campaign implementation scope |
| #3215 | unselected parent scan row; preserved outside campaign implementation scope |
| #3213 | unselected parent scan row; preserved outside campaign implementation scope |
| #3211 | unselected parent scan row; preserved outside campaign implementation scope |
| #3210 | unselected parent scan row; preserved outside campaign implementation scope |
| #3208 | unselected parent scan row; preserved outside campaign implementation scope |
| #3206 | unselected parent scan row; preserved outside campaign implementation scope |
| #3205 | unselected parent scan row; preserved outside campaign implementation scope |
| #3204 | unselected parent scan row; preserved outside campaign implementation scope |
| #3197 | unselected parent scan row; preserved outside campaign implementation scope |
| #3194 | unselected parent scan row; preserved outside campaign implementation scope |
| #3192 | unselected parent scan row; preserved outside campaign implementation scope |
| #3191 | unselected parent scan row; preserved outside campaign implementation scope |
| #3190 | unselected parent scan row; preserved outside campaign implementation scope |
| #3185 | unselected parent scan row; preserved outside campaign implementation scope |
| #3183 | unselected parent scan row; preserved outside campaign implementation scope |
| #3179 | unselected parent scan row; preserved outside campaign implementation scope |
| #3175 | unselected parent scan row; preserved outside campaign implementation scope |
| #3174 | unselected parent scan row; preserved outside campaign implementation scope |
| #3173 | unselected parent scan row; preserved outside campaign implementation scope |
| #3167 | unselected parent scan row; preserved outside campaign implementation scope |
| #3165 | unselected parent scan row; preserved outside campaign implementation scope |
| #3163 | unselected parent scan row; preserved outside campaign implementation scope |
| #3161 | unselected parent scan row; preserved outside campaign implementation scope |
| #3143 | unselected parent scan row; preserved outside campaign implementation scope |
| #3137 | unselected parent scan row; preserved outside campaign implementation scope |
| #3132 | unselected parent scan row; preserved outside campaign implementation scope |
| #3126 | unselected parent scan row; preserved outside campaign implementation scope |
| #3125 | unselected parent scan row; preserved outside campaign implementation scope |
| #3124 | unselected parent scan row; preserved outside campaign implementation scope |
| #3117 | unselected parent scan row; preserved outside campaign implementation scope |
| #3116 | unselected parent scan row; preserved outside campaign implementation scope |
| #3114 | unselected parent scan row; preserved outside campaign implementation scope |
| #3107 | unselected parent scan row; preserved outside campaign implementation scope |
| #3088 | unselected parent scan row; preserved outside campaign implementation scope |
| #3087 | unselected parent scan row; preserved outside campaign implementation scope |
| #3083 | unselected parent scan row; preserved outside campaign implementation scope |
| #3082 | unselected parent scan row; preserved outside campaign implementation scope |
| #3081 | unselected parent scan row; preserved outside campaign implementation scope |
| #3078 | unselected parent scan row; preserved outside campaign implementation scope |
| #3077 | unselected parent scan row; preserved outside campaign implementation scope |
| #3075 | unselected parent scan row; preserved outside campaign implementation scope |
| #3065 | unselected parent scan row; preserved outside campaign implementation scope |
| #3064 | unselected parent scan row; preserved outside campaign implementation scope |
| #3062 | unselected parent scan row; preserved outside campaign implementation scope |
| #3057 | unselected parent scan row; preserved outside campaign implementation scope |
| #3054 | unselected parent scan row; preserved outside campaign implementation scope |
| #3051 | unselected parent scan row; preserved outside campaign implementation scope |
| #3048 | unselected parent scan row; preserved outside campaign implementation scope |
| #3047 | unselected parent scan row; preserved outside campaign implementation scope |
| #3042 | unselected parent scan row; preserved outside campaign implementation scope |
| #3032 | unselected parent scan row; preserved outside campaign implementation scope |
| #3031 | unselected parent scan row; preserved outside campaign implementation scope |
| #3026 | unselected parent scan row; preserved outside campaign implementation scope |
| #3015 | unselected parent scan row; preserved outside campaign implementation scope |
| #3012 | unselected parent scan row; preserved outside campaign implementation scope |
| #2998 | unselected parent scan row; preserved outside campaign implementation scope |
| #2960 | unselected parent scan row; preserved outside campaign implementation scope |
| #2957 | unselected parent scan row; preserved outside campaign implementation scope |
| #2956 | unselected parent scan row; preserved outside campaign implementation scope |
| #2955 | unselected parent scan row; preserved outside campaign implementation scope |
| #2954 | unselected parent scan row; preserved outside campaign implementation scope |
| #2952 | unselected parent scan row; preserved outside campaign implementation scope |
| #2948 | unselected parent scan row; preserved outside campaign implementation scope |
| #2944 | unselected parent scan row; preserved outside campaign implementation scope |
| #2943 | unselected parent scan row; preserved outside campaign implementation scope |
| #2941 | unselected parent scan row; preserved outside campaign implementation scope |
| #2937 | unselected parent scan row; preserved outside campaign implementation scope |
| #2928 | unselected parent scan row; preserved outside campaign implementation scope |
| #2925 | unselected parent scan row; preserved outside campaign implementation scope |
| #2922 | unselected parent scan row; preserved outside campaign implementation scope |
| #2908 | unselected parent scan row; preserved outside campaign implementation scope |
| #2907 | unselected parent scan row; preserved outside campaign implementation scope |
| #2904 | unselected parent scan row; preserved outside campaign implementation scope |
| #2900 | unselected parent scan row; preserved outside campaign implementation scope |
| #2899 | unselected parent scan row; preserved outside campaign implementation scope |
| #2898 | unselected parent scan row; preserved outside campaign implementation scope |
| #2893 | unselected parent scan row; preserved outside campaign implementation scope |
| #2892 | unselected parent scan row; preserved outside campaign implementation scope |
| #2891 | unselected parent scan row; preserved outside campaign implementation scope |
| #2887 | unselected parent scan row; preserved outside campaign implementation scope |
| #2879 | unselected parent scan row; preserved outside campaign implementation scope |
| #2871 | unselected parent scan row; preserved outside campaign implementation scope |
| #2869 | unselected parent scan row; preserved outside campaign implementation scope |
| #2857 | unselected parent scan row; preserved outside campaign implementation scope |
| #2850 | unselected parent scan row; preserved outside campaign implementation scope |
| #2847 | unselected parent scan row; preserved outside campaign implementation scope |
| #2845 | unselected parent scan row; preserved outside campaign implementation scope |
| #2837 | unselected parent scan row; preserved outside campaign implementation scope |
| #2833 | unselected parent scan row; preserved outside campaign implementation scope |
| #2831 | unselected parent scan row; preserved outside campaign implementation scope |
| #2829 | unselected parent scan row; preserved outside campaign implementation scope |
| #2824 | unselected parent scan row; preserved outside campaign implementation scope |
| #2823 | unselected parent scan row; preserved outside campaign implementation scope |
| #2822 | unselected parent scan row; preserved outside campaign implementation scope |
| #2818 | unselected parent scan row; preserved outside campaign implementation scope |
| #2812 | unselected parent scan row; preserved outside campaign implementation scope |
| #2811 | unselected parent scan row; preserved outside campaign implementation scope |
| #2809 | unselected parent scan row; preserved outside campaign implementation scope |
| #2800 | unselected parent scan row; preserved outside campaign implementation scope |
| #2798 | unselected parent scan row; preserved outside campaign implementation scope |
| #2793 | unselected parent scan row; preserved outside campaign implementation scope |
| #2787 | unselected parent scan row; preserved outside campaign implementation scope |
| #2786 | unselected parent scan row; preserved outside campaign implementation scope |
| #2784 | unselected parent scan row; preserved outside campaign implementation scope |
| #2783 | unselected parent scan row; preserved outside campaign implementation scope |
| #2780 | unselected parent scan row; preserved outside campaign implementation scope |
| #2777 | unselected parent scan row; preserved outside campaign implementation scope |
| #2776 | unselected parent scan row; preserved outside campaign implementation scope |
| #2775 | unselected parent scan row; preserved outside campaign implementation scope |
| #2769 | unselected parent scan row; preserved outside campaign implementation scope |
| #2764 | unselected parent scan row; preserved outside campaign implementation scope |
| #2762 | unselected parent scan row; preserved outside campaign implementation scope |
| #2761 | unselected parent scan row; preserved outside campaign implementation scope |
| #2755 | unselected parent scan row; preserved outside campaign implementation scope |
| #2753 | unselected parent scan row; preserved outside campaign implementation scope |
| #2748 | unselected parent scan row; preserved outside campaign implementation scope |
| #2747 | unselected parent scan row; preserved outside campaign implementation scope |
| #2738 | unselected parent scan row; preserved outside campaign implementation scope |
| #2736 | unselected parent scan row; preserved outside campaign implementation scope |
| #2732 | unselected parent scan row; preserved outside campaign implementation scope |
| #2731 | unselected parent scan row; preserved outside campaign implementation scope |
| #2725 | unselected parent scan row; preserved outside campaign implementation scope |
| #2724 | unselected parent scan row; preserved outside campaign implementation scope |
| #2723 | unselected parent scan row; preserved outside campaign implementation scope |
| #2715 | unselected parent scan row; preserved outside campaign implementation scope |
| #2713 | unselected parent scan row; preserved outside campaign implementation scope |
| #2710 | unselected parent scan row; preserved outside campaign implementation scope |
| #2709 | unselected parent scan row; preserved outside campaign implementation scope |
| #2706 | unselected parent scan row; preserved outside campaign implementation scope |
| #2705 | unselected parent scan row; preserved outside campaign implementation scope |
| #2698 | unselected parent scan row; preserved outside campaign implementation scope |
| #2697 | unselected parent scan row; preserved outside campaign implementation scope |
| #2691 | unselected parent scan row; preserved outside campaign implementation scope |
| #2689 | unselected parent scan row; preserved outside campaign implementation scope |
| #2686 | unselected parent scan row; preserved outside campaign implementation scope |
| #2685 | unselected parent scan row; preserved outside campaign implementation scope |
| #2683 | unselected parent scan row; preserved outside campaign implementation scope |
| #2672 | unselected parent scan row; preserved outside campaign implementation scope |
| #2668 | unselected parent scan row; preserved outside campaign implementation scope |
| #2667 | unselected parent scan row; preserved outside campaign implementation scope |
| #2664 | unselected parent scan row; preserved outside campaign implementation scope |
| #2663 | unselected parent scan row; preserved outside campaign implementation scope |
| #2658 | unselected parent scan row; preserved outside campaign implementation scope |
| #2657 | unselected parent scan row; preserved outside campaign implementation scope |
| #2656 | unselected parent scan row; preserved outside campaign implementation scope |
| #2655 | unselected parent scan row; preserved outside campaign implementation scope |
| #2652 | unselected parent scan row; preserved outside campaign implementation scope |
| #2650 | unselected parent scan row; preserved outside campaign implementation scope |
| #2647 | unselected parent scan row; preserved outside campaign implementation scope |
| #2646 | unselected parent scan row; preserved outside campaign implementation scope |
| #2645 | unselected parent scan row; preserved outside campaign implementation scope |
| #2639 | unselected parent scan row; preserved outside campaign implementation scope |
| #2634 | unselected parent scan row; preserved outside campaign implementation scope |
| #2622 | unselected parent scan row; preserved outside campaign implementation scope |
| #2618 | unselected parent scan row; preserved outside campaign implementation scope |
| #2615 | unselected parent scan row; preserved outside campaign implementation scope |
| #2605 | unselected parent scan row; preserved outside campaign implementation scope |
| #2589 | unselected parent scan row; preserved outside campaign implementation scope |
| #2588 | unselected parent scan row; preserved outside campaign implementation scope |
| #2585 | unselected parent scan row; preserved outside campaign implementation scope |
| #2576 | unselected parent scan row; preserved outside campaign implementation scope |
| #2575 | unselected parent scan row; preserved outside campaign implementation scope |
| #2573 | unselected parent scan row; preserved outside campaign implementation scope |
| #2572 | unselected parent scan row; preserved outside campaign implementation scope |
| #2570 | unselected parent scan row; preserved outside campaign implementation scope |
| #2565 | unselected parent scan row; preserved outside campaign implementation scope |
| #2562 | unselected parent scan row; preserved outside campaign implementation scope |
| #2554 | unselected parent scan row; preserved outside campaign implementation scope |
| #2553 | unselected parent scan row; preserved outside campaign implementation scope |
| #2550 | unselected parent scan row; preserved outside campaign implementation scope |
| #2547 | unselected parent scan row; preserved outside campaign implementation scope |
| #2542 | unselected parent scan row; preserved outside campaign implementation scope |
| #2541 | unselected parent scan row; preserved outside campaign implementation scope |
| #2534 | unselected parent scan row; preserved outside campaign implementation scope |
| #2528 | unselected parent scan row; preserved outside campaign implementation scope |
| #2526 | unselected parent scan row; preserved outside campaign implementation scope |
| #2525 | unselected parent scan row; preserved outside campaign implementation scope |
| #2523 | unselected parent scan row; preserved outside campaign implementation scope |
| #2511 | unselected parent scan row; preserved outside campaign implementation scope |
| #2508 | unselected parent scan row; preserved outside campaign implementation scope |
| #2480 | unselected parent scan row; preserved outside campaign implementation scope |
| #2475 | unselected parent scan row; preserved outside campaign implementation scope |
| #2474 | unselected parent scan row; preserved outside campaign implementation scope |
| #2465 | unselected parent scan row; preserved outside campaign implementation scope |
| #2462 | unselected parent scan row; preserved outside campaign implementation scope |
| #2459 | unselected parent scan row; preserved outside campaign implementation scope |
| #2454 | unselected parent scan row; preserved outside campaign implementation scope |
| #2453 | unselected parent scan row; preserved outside campaign implementation scope |
| #2452 | unselected parent scan row; preserved outside campaign implementation scope |
| #2443 | unselected parent scan row; preserved outside campaign implementation scope |
| #2439 | unselected parent scan row; preserved outside campaign implementation scope |
| #2437 | unselected parent scan row; preserved outside campaign implementation scope |
| #2422 | unselected parent scan row; preserved outside campaign implementation scope |
| #2415 | unselected parent scan row; preserved outside campaign implementation scope |
| #2414 | unselected parent scan row; preserved outside campaign implementation scope |
| #2404 | unselected parent scan row; preserved outside campaign implementation scope |
| #2390 | unselected parent scan row; preserved outside campaign implementation scope |
| #2378 | unselected parent scan row; preserved outside campaign implementation scope |
| #2369 | unselected parent scan row; preserved outside campaign implementation scope |
| #2361 | unselected parent scan row; preserved outside campaign implementation scope |
| #2355 | unselected parent scan row; preserved outside campaign implementation scope |
| #2348 | unselected parent scan row; preserved outside campaign implementation scope |
| #2343 | unselected parent scan row; preserved outside campaign implementation scope |
| #2340 | unselected parent scan row; preserved outside campaign implementation scope |
| #2331 | unselected parent scan row; preserved outside campaign implementation scope |
| #2329 | unselected parent scan row; preserved outside campaign implementation scope |
| #2325 | unselected parent scan row; preserved outside campaign implementation scope |
| #2324 | unselected parent scan row; preserved outside campaign implementation scope |
| #2323 | unselected parent scan row; preserved outside campaign implementation scope |
| #2322 | unselected parent scan row; preserved outside campaign implementation scope |
| #2321 | unselected parent scan row; preserved outside campaign implementation scope |
| #2320 | unselected parent scan row; preserved outside campaign implementation scope |
| #2319 | unselected parent scan row; preserved outside campaign implementation scope |
| #2318 | unselected parent scan row; preserved outside campaign implementation scope |
| #2317 | unselected parent scan row; preserved outside campaign implementation scope |
| #2316 | unselected parent scan row; preserved outside campaign implementation scope |
| #2315 | unselected parent scan row; preserved outside campaign implementation scope |
| #2314 | unselected parent scan row; preserved outside campaign implementation scope |
| #2313 | unselected parent scan row; preserved outside campaign implementation scope |
| #2312 | unselected parent scan row; preserved outside campaign implementation scope |
| #2301 | unselected parent scan row; preserved outside campaign implementation scope |
| #2300 | unselected parent scan row; preserved outside campaign implementation scope |
| #2299 | unselected parent scan row; preserved outside campaign implementation scope |
| #2298 | unselected parent scan row; preserved outside campaign implementation scope |
| #2295 | unselected parent scan row; preserved outside campaign implementation scope |
| #2294 | unselected parent scan row; preserved outside campaign implementation scope |
| #2292 | unselected parent scan row; preserved outside campaign implementation scope |
| #2291 | unselected parent scan row; preserved outside campaign implementation scope |
| #2285 | unselected parent scan row; preserved outside campaign implementation scope |
| #2284 | unselected parent scan row; preserved outside campaign implementation scope |
| #2281 | unselected parent scan row; preserved outside campaign implementation scope |
| #2266 | unselected parent scan row; preserved outside campaign implementation scope |
| #2262 | unselected parent scan row; preserved outside campaign implementation scope |
| #2255 | unselected parent scan row; preserved outside campaign implementation scope |
| #2254 | unselected parent scan row; preserved outside campaign implementation scope |
| #2253 | unselected parent scan row; preserved outside campaign implementation scope |
| #2247 | unselected parent scan row; preserved outside campaign implementation scope |
| #2245 | unselected parent scan row; preserved outside campaign implementation scope |
| #2242 | unselected parent scan row; preserved outside campaign implementation scope |
| #2237 | unselected parent scan row; preserved outside campaign implementation scope |
| #2235 | unselected parent scan row; preserved outside campaign implementation scope |
| #2234 | unselected parent scan row; preserved outside campaign implementation scope |
| #2222 | unselected parent scan row; preserved outside campaign implementation scope |
| #2216 | unselected parent scan row; preserved outside campaign implementation scope |
| #2210 | unselected parent scan row; preserved outside campaign implementation scope |
| #2203 | unselected parent scan row; preserved outside campaign implementation scope |
| #2190 | unselected parent scan row; preserved outside campaign implementation scope |
| #2185 | unselected parent scan row; preserved outside campaign implementation scope |
| #2183 | unselected parent scan row; preserved outside campaign implementation scope |
| #2178 | unselected parent scan row; preserved outside campaign implementation scope |
| #2177 | unselected parent scan row; preserved outside campaign implementation scope |
| #2172 | unselected parent scan row; preserved outside campaign implementation scope |
| #2171 | unselected parent scan row; preserved outside campaign implementation scope |
| #2166 | unselected parent scan row; preserved outside campaign implementation scope |
| #2156 | unselected parent scan row; preserved outside campaign implementation scope |
| #2154 | unselected parent scan row; preserved outside campaign implementation scope |
| #2153 | unselected parent scan row; preserved outside campaign implementation scope |
| #2152 | unselected parent scan row; preserved outside campaign implementation scope |
| #2150 | unselected parent scan row; preserved outside campaign implementation scope |
| #2149 | unselected parent scan row; preserved outside campaign implementation scope |
| #2148 | unselected parent scan row; preserved outside campaign implementation scope |
| #2147 | unselected parent scan row; preserved outside campaign implementation scope |
| #2146 | unselected parent scan row; preserved outside campaign implementation scope |
| #2143 | unselected parent scan row; preserved outside campaign implementation scope |
| #2140 | unselected parent scan row; preserved outside campaign implementation scope |
| #2137 | unselected parent scan row; preserved outside campaign implementation scope |
| #2136 | unselected parent scan row; preserved outside campaign implementation scope |
| #2134 | unselected parent scan row; preserved outside campaign implementation scope |
| #2133 | unselected parent scan row; preserved outside campaign implementation scope |
| #2130 | unselected parent scan row; preserved outside campaign implementation scope |
| #2129 | unselected parent scan row; preserved outside campaign implementation scope |
| #2128 | unselected parent scan row; preserved outside campaign implementation scope |
| #2127 | unselected parent scan row; preserved outside campaign implementation scope |
| #2124 | unselected parent scan row; preserved outside campaign implementation scope |
| #2123 | unselected parent scan row; preserved outside campaign implementation scope |
| #2112 | unselected parent scan row; preserved outside campaign implementation scope |
| #2111 | unselected parent scan row; preserved outside campaign implementation scope |
| #2091 | unselected parent scan row; preserved outside campaign implementation scope |
| #2090 | unselected parent scan row; preserved outside campaign implementation scope |
| #2081 | unselected parent scan row; preserved outside campaign implementation scope |
| #2068 | unselected parent scan row; preserved outside campaign implementation scope |
| #2064 | unselected parent scan row; preserved outside campaign implementation scope |
| #2063 | unselected parent scan row; preserved outside campaign implementation scope |
| #2053 | unselected parent scan row; preserved outside campaign implementation scope |
| #2045 | unselected parent scan row; preserved outside campaign implementation scope |
| #2030 | unselected parent scan row; preserved outside campaign implementation scope |
| #2020 | unselected parent scan row; preserved outside campaign implementation scope |
| #2018 | unselected parent scan row; preserved outside campaign implementation scope |
| #2009 | unselected parent scan row; preserved outside campaign implementation scope |
| #2006 | unselected parent scan row; preserved outside campaign implementation scope |
| #2001 | unselected parent scan row; preserved outside campaign implementation scope |
| #1999 | unselected parent scan row; preserved outside campaign implementation scope |
| #1991 | unselected parent scan row; preserved outside campaign implementation scope |
| #1987 | unselected parent scan row; preserved outside campaign implementation scope |
| #1977 | unselected parent scan row; preserved outside campaign implementation scope |
| #1976 | unselected parent scan row; preserved outside campaign implementation scope |
| #1959 | unselected parent scan row; preserved outside campaign implementation scope |
| #1958 | unselected parent scan row; preserved outside campaign implementation scope |
| #1938 | unselected parent scan row; preserved outside campaign implementation scope |
| #1936 | unselected parent scan row; preserved outside campaign implementation scope |
| #1925 | unselected parent scan row; preserved outside campaign implementation scope |
| #1921 | unselected parent scan row; preserved outside campaign implementation scope |
| #1919 | unselected parent scan row; preserved outside campaign implementation scope |
| #1902 | unselected parent scan row; preserved outside campaign implementation scope |
| #1900 | unselected parent scan row; preserved outside campaign implementation scope |
| #1898 | unselected parent scan row; preserved outside campaign implementation scope |
| #1893 | unselected parent scan row; preserved outside campaign implementation scope |
| #1883 | unselected parent scan row; preserved outside campaign implementation scope |
| #1875 | unselected parent scan row; preserved outside campaign implementation scope |
| #1854 | unselected parent scan row; preserved outside campaign implementation scope |
| #1848 | unselected parent scan row; preserved outside campaign implementation scope |
| #1843 | unselected parent scan row; preserved outside campaign implementation scope |
| #1833 | unselected parent scan row; preserved outside campaign implementation scope |
| #1829 | unselected parent scan row; preserved outside campaign implementation scope |
| #1828 | unselected parent scan row; preserved outside campaign implementation scope |
| #1827 | unselected parent scan row; preserved outside campaign implementation scope |
| #1825 | unselected parent scan row; preserved outside campaign implementation scope |
| #1824 | unselected parent scan row; preserved outside campaign implementation scope |
| #1823 | unselected parent scan row; preserved outside campaign implementation scope |
| #1821 | unselected parent scan row; preserved outside campaign implementation scope |
| #1819 | unselected parent scan row; preserved outside campaign implementation scope |
| #1816 | unselected parent scan row; preserved outside campaign implementation scope |
| #1813 | unselected parent scan row; preserved outside campaign implementation scope |
| #1810 | unselected parent scan row; preserved outside campaign implementation scope |
| #1805 | unselected parent scan row; preserved outside campaign implementation scope |
| #1803 | unselected parent scan row; preserved outside campaign implementation scope |
| #1802 | unselected parent scan row; preserved outside campaign implementation scope |
| #1801 | unselected parent scan row; preserved outside campaign implementation scope |
| #1797 | unselected parent scan row; preserved outside campaign implementation scope |
| #1794 | unselected parent scan row; preserved outside campaign implementation scope |
| #1793 | unselected parent scan row; preserved outside campaign implementation scope |
| #1792 | unselected parent scan row; preserved outside campaign implementation scope |
| #1784 | unselected parent scan row; preserved outside campaign implementation scope |
| #1781 | unselected parent scan row; preserved outside campaign implementation scope |
| #1774 | unselected parent scan row; preserved outside campaign implementation scope |
| #1773 | unselected parent scan row; preserved outside campaign implementation scope |
| #1764 | unselected parent scan row; preserved outside campaign implementation scope |
| #1761 | unselected parent scan row; preserved outside campaign implementation scope |
| #1760 | unselected parent scan row; preserved outside campaign implementation scope |
| #1740 | unselected parent scan row; preserved outside campaign implementation scope |
| #1738 | unselected parent scan row; preserved outside campaign implementation scope |
| #1724 | unselected parent scan row; preserved outside campaign implementation scope |
| #1717 | unselected parent scan row; preserved outside campaign implementation scope |
| #1716 | unselected parent scan row; preserved outside campaign implementation scope |
| #1711 | unselected parent scan row; preserved outside campaign implementation scope |
| #1701 | unselected parent scan row; preserved outside campaign implementation scope |
| #1694 | unselected parent scan row; preserved outside campaign implementation scope |
| #1686 | unselected parent scan row; preserved outside campaign implementation scope |
| #1685 | unselected parent scan row; preserved outside campaign implementation scope |
| #1681 | unselected parent scan row; preserved outside campaign implementation scope |
| #1672 | unselected parent scan row; preserved outside campaign implementation scope |
| #1670 | unselected parent scan row; preserved outside campaign implementation scope |
| #1666 | unselected parent scan row; preserved outside campaign implementation scope |
| #1665 | unselected parent scan row; preserved outside campaign implementation scope |
| #1655 | unselected parent scan row; preserved outside campaign implementation scope |
| #1652 | unselected parent scan row; preserved outside campaign implementation scope |
| #1643 | unselected parent scan row; preserved outside campaign implementation scope |
| #1636 | unselected parent scan row; preserved outside campaign implementation scope |
| #1633 | unselected parent scan row; preserved outside campaign implementation scope |
| #1626 | unselected parent scan row; preserved outside campaign implementation scope |
| #1615 | unselected parent scan row; preserved outside campaign implementation scope |
| #1614 | unselected parent scan row; preserved outside campaign implementation scope |
| #1606 | unselected parent scan row; preserved outside campaign implementation scope |
| #1600 | unselected parent scan row; preserved outside campaign implementation scope |
| #1599 | unselected parent scan row; preserved outside campaign implementation scope |
| #1585 | unselected parent scan row; preserved outside campaign implementation scope |
| #1574 | unselected parent scan row; preserved outside campaign implementation scope |
| #1573 | unselected parent scan row; preserved outside campaign implementation scope |
| #1570 | unselected parent scan row; preserved outside campaign implementation scope |
| #1568 | unselected parent scan row; preserved outside campaign implementation scope |
| #1561 | unselected parent scan row; preserved outside campaign implementation scope |
| #1560 | unselected parent scan row; preserved outside campaign implementation scope |
| #1559 | unselected parent scan row; preserved outside campaign implementation scope |
| #1558 | unselected parent scan row; preserved outside campaign implementation scope |
| #1530 | unselected parent scan row; preserved outside campaign implementation scope |
| #1522 | unselected parent scan row; preserved outside campaign implementation scope |
| #1510 | unselected parent scan row; preserved outside campaign implementation scope |
| #1509 | unselected parent scan row; preserved outside campaign implementation scope |
| #1508 | unselected parent scan row; preserved outside campaign implementation scope |
| #1506 | unselected parent scan row; preserved outside campaign implementation scope |
| #1505 | unselected parent scan row; preserved outside campaign implementation scope |
| #1504 | unselected parent scan row; preserved outside campaign implementation scope |
| #1502 | unselected parent scan row; preserved outside campaign implementation scope |
| #1500 | unselected parent scan row; preserved outside campaign implementation scope |
| #1498 | unselected parent scan row; preserved outside campaign implementation scope |
| #1497 | unselected parent scan row; preserved outside campaign implementation scope |
| #1488 | unselected parent scan row; preserved outside campaign implementation scope |
| #1478 | unselected parent scan row; preserved outside campaign implementation scope |
| #1463 | unselected parent scan row; preserved outside campaign implementation scope |
| #1460 | unselected parent scan row; preserved outside campaign implementation scope |
| #1458 | unselected parent scan row; preserved outside campaign implementation scope |
| #1455 | unselected parent scan row; preserved outside campaign implementation scope |
| #1450 | unselected parent scan row; preserved outside campaign implementation scope |
| #1448 | unselected parent scan row; preserved outside campaign implementation scope |
| #1445 | unselected parent scan row; preserved outside campaign implementation scope |
| #1436 | unselected parent scan row; preserved outside campaign implementation scope |
| #1434 | unselected parent scan row; preserved outside campaign implementation scope |
| #1427 | unselected parent scan row; preserved outside campaign implementation scope |
| #1426 | unselected parent scan row; preserved outside campaign implementation scope |
| #1425 | unselected parent scan row; preserved outside campaign implementation scope |
| #1423 | unselected parent scan row; preserved outside campaign implementation scope |
| #1421 | unselected parent scan row; preserved outside campaign implementation scope |
| #1418 | unselected parent scan row; preserved outside campaign implementation scope |
| #1416 | unselected parent scan row; preserved outside campaign implementation scope |
| #1415 | unselected parent scan row; preserved outside campaign implementation scope |
| #1412 | unselected parent scan row; preserved outside campaign implementation scope |
| #1410 | unselected parent scan row; preserved outside campaign implementation scope |
| #1405 | unselected parent scan row; preserved outside campaign implementation scope |
| #1402 | unselected parent scan row; preserved outside campaign implementation scope |
| #1401 | unselected parent scan row; preserved outside campaign implementation scope |
| #1399 | unselected parent scan row; preserved outside campaign implementation scope |
| #1397 | unselected parent scan row; preserved outside campaign implementation scope |
| #1395 | unselected parent scan row; preserved outside campaign implementation scope |
| #1392 | unselected parent scan row; preserved outside campaign implementation scope |
| #1391 | unselected parent scan row; preserved outside campaign implementation scope |
| #1388 | unselected parent scan row; preserved outside campaign implementation scope |
| #1387 | unselected parent scan row; preserved outside campaign implementation scope |
| #1385 | unselected parent scan row; preserved outside campaign implementation scope |
| #1384 | unselected parent scan row; preserved outside campaign implementation scope |
| #1383 | unselected parent scan row; preserved outside campaign implementation scope |
| #1375 | unselected parent scan row; preserved outside campaign implementation scope |
| #1374 | unselected parent scan row; preserved outside campaign implementation scope |
| #1367 | unselected parent scan row; preserved outside campaign implementation scope |
| #1349 | unselected parent scan row; preserved outside campaign implementation scope |
| #1348 | unselected parent scan row; preserved outside campaign implementation scope |
| #1347 | unselected parent scan row; preserved outside campaign implementation scope |
| #1346 | unselected parent scan row; preserved outside campaign implementation scope |
| #1344 | unselected parent scan row; preserved outside campaign implementation scope |
| #1340 | unselected parent scan row; preserved outside campaign implementation scope |
| #1339 | unselected parent scan row; preserved outside campaign implementation scope |
| #1338 | unselected parent scan row; preserved outside campaign implementation scope |
| #1337 | unselected parent scan row; preserved outside campaign implementation scope |
| #1335 | unselected parent scan row; preserved outside campaign implementation scope |
| #1334 | unselected parent scan row; preserved outside campaign implementation scope |
| #1332 | unselected parent scan row; preserved outside campaign implementation scope |
| #1331 | unselected parent scan row; preserved outside campaign implementation scope |
| #1324 | unselected parent scan row; preserved outside campaign implementation scope |
| #1317 | unselected parent scan row; preserved outside campaign implementation scope |
| #1316 | unselected parent scan row; preserved outside campaign implementation scope |
| #1313 | unselected parent scan row; preserved outside campaign implementation scope |
| #1301 | unselected parent scan row; preserved outside campaign implementation scope |
| #1297 | unselected parent scan row; preserved outside campaign implementation scope |
| #1296 | unselected parent scan row; preserved outside campaign implementation scope |
| #1288 | unselected parent scan row; preserved outside campaign implementation scope |
| #1287 | unselected parent scan row; preserved outside campaign implementation scope |
| #1286 | unselected parent scan row; preserved outside campaign implementation scope |
| #1273 | unselected parent scan row; preserved outside campaign implementation scope |
| #1267 | unselected parent scan row; preserved outside campaign implementation scope |
| #1262 | unselected parent scan row; preserved outside campaign implementation scope |
| #1257 | unselected parent scan row; preserved outside campaign implementation scope |
| #1249 | unselected parent scan row; preserved outside campaign implementation scope |
| #1247 | unselected parent scan row; preserved outside campaign implementation scope |
| #1239 | unselected parent scan row; preserved outside campaign implementation scope |
| #1238 | unselected parent scan row; preserved outside campaign implementation scope |
| #1233 | unselected parent scan row; preserved outside campaign implementation scope |
| #1232 | unselected parent scan row; preserved outside campaign implementation scope |
| #1209 | unselected parent scan row; preserved outside campaign implementation scope |
| #1207 | unselected parent scan row; preserved outside campaign implementation scope |
| #1200 | unselected parent scan row; preserved outside campaign implementation scope |
| #1198 | unselected parent scan row; preserved outside campaign implementation scope |
| #1195 | unselected parent scan row; preserved outside campaign implementation scope |
| #1193 | unselected parent scan row; preserved outside campaign implementation scope |
| #1185 | unselected parent scan row; preserved outside campaign implementation scope |
| #1176 | unselected parent scan row; preserved outside campaign implementation scope |
| #1170 | unselected parent scan row; preserved outside campaign implementation scope |
| #1165 | unselected parent scan row; preserved outside campaign implementation scope |
| #1164 | unselected parent scan row; preserved outside campaign implementation scope |
| #1161 | unselected parent scan row; preserved outside campaign implementation scope |
| #1158 | unselected parent scan row; preserved outside campaign implementation scope |
| #1149 | unselected parent scan row; preserved outside campaign implementation scope |
| #1148 | unselected parent scan row; preserved outside campaign implementation scope |
| #1147 | unselected parent scan row; preserved outside campaign implementation scope |
| #1140 | unselected parent scan row; preserved outside campaign implementation scope |
| #1129 | unselected parent scan row; preserved outside campaign implementation scope |
| #1127 | unselected parent scan row; preserved outside campaign implementation scope |
| #1121 | unselected parent scan row; preserved outside campaign implementation scope |
| #1115 | unselected parent scan row; preserved outside campaign implementation scope |
| #1107 | unselected parent scan row; preserved outside campaign implementation scope |
| #1103 | unselected parent scan row; preserved outside campaign implementation scope |
| #1100 | unselected parent scan row; preserved outside campaign implementation scope |
| #1084 | unselected parent scan row; preserved outside campaign implementation scope |
| #1074 | unselected parent scan row; preserved outside campaign implementation scope |
| #1054 | unselected parent scan row; preserved outside campaign implementation scope |
| #1047 | unselected parent scan row; preserved outside campaign implementation scope |
| #1044 | unselected parent scan row; preserved outside campaign implementation scope |
| #1041 | unselected parent scan row; preserved outside campaign implementation scope |
| #1039 | unselected parent scan row; preserved outside campaign implementation scope |
| #1007 | unselected parent scan row; preserved outside campaign implementation scope |
| #1004 | unselected parent scan row; preserved outside campaign implementation scope |
| #1001 | unselected parent scan row; preserved outside campaign implementation scope |
| #995 | unselected parent scan row; preserved outside campaign implementation scope |
| #984 | unselected parent scan row; preserved outside campaign implementation scope |
| #980 | unselected parent scan row; preserved outside campaign implementation scope |
| #976 | unselected parent scan row; preserved outside campaign implementation scope |
| #963 | unselected parent scan row; preserved outside campaign implementation scope |
| #960 | unselected parent scan row; preserved outside campaign implementation scope |
| #947 | unselected parent scan row; preserved outside campaign implementation scope |
| #944 | unselected parent scan row; preserved outside campaign implementation scope |
| #941 | unselected parent scan row; preserved outside campaign implementation scope |
| #931 | unselected parent scan row; preserved outside campaign implementation scope |
| #923 | unselected parent scan row; preserved outside campaign implementation scope |
| #918 | unselected parent scan row; preserved outside campaign implementation scope |
| #900 | unselected parent scan row; preserved outside campaign implementation scope |
| #891 | unselected parent scan row; preserved outside campaign implementation scope |
| #884 | unselected parent scan row; preserved outside campaign implementation scope |
| #882 | unselected parent scan row; preserved outside campaign implementation scope |
| #879 | unselected parent scan row; preserved outside campaign implementation scope |
| #875 | unselected parent scan row; preserved outside campaign implementation scope |
| #873 | unselected parent scan row; preserved outside campaign implementation scope |
| #871 | unselected parent scan row; preserved outside campaign implementation scope |
| #865 | unselected parent scan row; preserved outside campaign implementation scope |
| #864 | unselected parent scan row; preserved outside campaign implementation scope |
| #854 | unselected parent scan row; preserved outside campaign implementation scope |
| #815 | unselected parent scan row; preserved outside campaign implementation scope |
| #811 | unselected parent scan row; preserved outside campaign implementation scope |
| #794 | unselected parent scan row; preserved outside campaign implementation scope |
| #758 | unselected parent scan row; preserved outside campaign implementation scope |
| #721 | unselected parent scan row; preserved outside campaign implementation scope |
| #717 | unselected parent scan row; preserved outside campaign implementation scope |
| #702 | unselected parent scan row; preserved outside campaign implementation scope |
| #695 | unselected parent scan row; preserved outside campaign implementation scope |
| #693 | unselected parent scan row; preserved outside campaign implementation scope |
| #665 | unselected parent scan row; preserved outside campaign implementation scope |
| #664 | unselected parent scan row; preserved outside campaign implementation scope |
| #657 | unselected parent scan row; preserved outside campaign implementation scope |
| #656 | unselected parent scan row; preserved outside campaign implementation scope |
| #655 | unselected parent scan row; preserved outside campaign implementation scope |
| #653 | unselected parent scan row; preserved outside campaign implementation scope |
| #652 | unselected parent scan row; preserved outside campaign implementation scope |
| #651 | unselected parent scan row; preserved outside campaign implementation scope |
| #650 | unselected parent scan row; preserved outside campaign implementation scope |
| #649 | unselected parent scan row; preserved outside campaign implementation scope |
| #648 | unselected parent scan row; preserved outside campaign implementation scope |
| #647 | unselected parent scan row; preserved outside campaign implementation scope |
| #646 | unselected parent scan row; preserved outside campaign implementation scope |
| #645 | unselected parent scan row; preserved outside campaign implementation scope |
| #644 | unselected parent scan row; preserved outside campaign implementation scope |
| #642 | unselected parent scan row; preserved outside campaign implementation scope |
| #641 | unselected parent scan row; preserved outside campaign implementation scope |
| #640 | unselected parent scan row; preserved outside campaign implementation scope |
| #639 | unselected parent scan row; preserved outside campaign implementation scope |
| #638 | unselected parent scan row; preserved outside campaign implementation scope |
| #637 | unselected parent scan row; preserved outside campaign implementation scope |
| #629 | unselected parent scan row; preserved outside campaign implementation scope |
| #628 | unselected parent scan row; preserved outside campaign implementation scope |
| #621 | unselected parent scan row; preserved outside campaign implementation scope |
| #601 | unselected parent scan row; preserved outside campaign implementation scope |
| #600 | unselected parent scan row; preserved outside campaign implementation scope |
| #586 | unselected parent scan row; preserved outside campaign implementation scope |
| #584 | unselected parent scan row; preserved outside campaign implementation scope |
| #577 | unselected parent scan row; preserved outside campaign implementation scope |
| #576 | unselected parent scan row; preserved outside campaign implementation scope |
| #568 | unselected parent scan row; preserved outside campaign implementation scope |
| #534 | unselected parent scan row; preserved outside campaign implementation scope |
| #520 | unselected parent scan row; preserved outside campaign implementation scope |
| #518 | unselected parent scan row; preserved outside campaign implementation scope |
| #513 | unselected parent scan row; preserved outside campaign implementation scope |
| #501 | unselected parent scan row; preserved outside campaign implementation scope |
| #485 | unselected parent scan row; preserved outside campaign implementation scope |
| #474 | unselected parent scan row; preserved outside campaign implementation scope |
| #469 | unselected parent scan row; preserved outside campaign implementation scope |
| #468 | unselected parent scan row; preserved outside campaign implementation scope |
| #467 | unselected parent scan row; preserved outside campaign implementation scope |
| #466 | unselected parent scan row; preserved outside campaign implementation scope |
| #448 | unselected parent scan row; preserved outside campaign implementation scope |
| #447 | unselected parent scan row; preserved outside campaign implementation scope |
| #437 | unselected parent scan row; preserved outside campaign implementation scope |
| #424 | unselected parent scan row; preserved outside campaign implementation scope |
| #422 | unselected parent scan row; preserved outside campaign implementation scope |
| #421 | unselected parent scan row; preserved outside campaign implementation scope |
| #420 | unselected parent scan row; preserved outside campaign implementation scope |
| #412 | unselected parent scan row; preserved outside campaign implementation scope |
| #410 | unselected parent scan row; preserved outside campaign implementation scope |
| #407 | unselected parent scan row; preserved outside campaign implementation scope |
| #400 | unselected parent scan row; preserved outside campaign implementation scope |
| #399 | unselected parent scan row; preserved outside campaign implementation scope |
| #392 | unselected parent scan row; preserved outside campaign implementation scope |
| #361 | unselected parent scan row; preserved outside campaign implementation scope |
| #360 | unselected parent scan row; preserved outside campaign implementation scope |
| #349 | unselected parent scan row; preserved outside campaign implementation scope |
| #345 | unselected parent scan row; preserved outside campaign implementation scope |
| #339 | unselected parent scan row; preserved outside campaign implementation scope |
| #337 | unselected parent scan row; preserved outside campaign implementation scope |
| #297 | unselected parent scan row; preserved outside campaign implementation scope |
| #290 | unselected parent scan row; preserved outside campaign implementation scope |
| #286 | unselected parent scan row; preserved outside campaign implementation scope |
| #259 | unselected parent scan row; preserved outside campaign implementation scope |
| #257 | unselected parent scan row; preserved outside campaign implementation scope |
| #224 | unselected parent scan row; preserved outside campaign implementation scope |
| #189 | unselected parent scan row; preserved outside campaign implementation scope |
| #141 | unselected parent scan row; preserved outside campaign implementation scope |
| #137 | unselected parent scan row; preserved outside campaign implementation scope |
| #130 | unselected parent scan row; preserved outside campaign implementation scope |
| #112 | unselected parent scan row; preserved outside campaign implementation scope |
| #111 | unselected parent scan row; preserved outside campaign implementation scope |
| #1 | unselected parent scan row; preserved outside campaign implementation scope |
