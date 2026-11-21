# #1073: Late June existing Kiro wire compatibility

## Scope and pins

This report compares the exact public PR-head patches with the installed Kiro wire path and offline fixtures. The enclosing merges are recorded as provenance only; their unrelated changes are not attributed to these PRs.

| PR | Exact head | Enclosing merge | Exact change reviewed |
| --- | --- | --- | --- |
| [OmniRoute #4459](https://github.com/cheaper-inference/OmniRoute/pull/4459/commits/e1bb25543261d4cd8a6cd9b38d98ad7da86f0bc8) | `e1bb25543261d4cd8a6cd9b38d98ad7da86f0bc8` | `404d9b327a586038702bb016e600c8a9980940c5` | One new non-streaming SSE terminal-scan test file |
| [OmniRoute #4736](https://github.com/cheaper-inference/OmniRoute/pull/4736/commits/e5abc8db0a8b35964fffd88dd8de2099adfdbead) | `e5abc8db0a8b35964fffd88dd8de2099adfdbead` | `6e28889aaddda1192c7b193f867fa112f2f51ef2` | Shared fallback tool-call ID helper; Kiro response caller updated |
| [OmniRoute #4763](https://github.com/cheaper-inference/OmniRoute/pull/4763/commits/2376633f809ef72d02be64710b04096b4102c2ba) | `2376633f809ef72d02be64710b04096b4102c2ba` | `0d9029905e0c5a7f5dc48263b48fed94a5115bfa` | Gate three Kiro image input forms on Claude model name |

## Installed contract and fixture evidence

The installed request path is `open-sse/translator/request/openai-to-kiro.js`; it converts user image URL/base64 parts and Claude base64 image blocks into `userInputMessage.images`. At lines 386–404, image extraction has no model-capability guard. The resolved model is supplied to `convertMessages`, but image extraction occurs regardless of whether its name is Claude-backed. Text content is still collected independently. Kiro response execution converts EventStream frames in `open-sse/executors/kiro.js`, and the Kiro-to-OpenAI response translator handles raw `toolUseEvent` output as well as executor-produced OpenAI chunks.

Current fixtures establish the surrounding contract:

- `tests/unit/openai-to-kiro.test.js` covers image forwarding, multiple base64 images, omission of an empty images field, and combined text plus image payloads. It does not distinguish Claude from non-Claude Kiro models.
- `tests/translator/bugs-kiro.test.js` covers preservation of same-format images and inline images in history/current turns. These are general wire-preservation fixtures, not a model capability matrix.
- `tests/unit/kiro-tool-name-cache-3107.test.js` covers Kiro toolUseEvent response translation, tool-name restoration, and the executor-produced chunk path. Missing tool IDs use the current shared `fallbackToolCallId` helper.
- `open-sse/translator/concerns/toolCall.js` defines `fallbackToolCallId(index)` with the same outputs as #4736: `call_<timestamp>` when omitted and `call_<index>_<timestamp>` when defined, including index zero.
- The #4459 test concerns `appendNonStreamingSseTerminalSignal`'s generic data-line type-scan optimization. The installed tree has no corresponding helper or fixture; its current SSE handling lives in the general streaming handlers. The pinned PR-head patch adds tests only, and it does not alter Kiro request shaping, EventStream frame parsing, or Kiro response translation.

Two nearby Kiro behaviors are already qualified independently and are not evidence for these PRs:

- `tests/unit/omni-kiro-structured-tool-results.test.js` checks the qualified #2447 tool-result projection: text and structured content survive, image payloads are represented without exposing their bytes/URLs, `is_error` becomes Kiro `status: "error"`, and tool IDs remain paired. It covers OpenAI and Claude tool-result forms.
- `tests/unit/omni-kiro-direct-claude-turn-order.test.js` checks the direct Claude turn-order repair: assistant-ended histories preserve order, final tool results are not duplicated, and continuation does not replay old user content.

## Dispositions

### #4459 — no Kiro wire port

The exact head is a generic regression test for recognizing typed terminals, Claude `event:` terminals with typeless data, ordinary OpenAI chunks, and `[DONE]`. It does not patch Kiro executor/request/response behavior. The local translator/executor paths do not expose the named helper under test, so this is not an actionable Kiro compatibility gap. Disposition: **do not port**; retain as upstream-only generic SSE evidence.

### #4736 — already satisfied

The exact head extracts an existing ID shape into a shared helper and changes the raw Kiro tool-use response fallback to call it. The local shared helper already yields that same shape, and `kiroToOpenAIResponse` calls it when `toolUseId` is missing. No wire difference is demonstrated. Disposition: **already covered; no change**. Current specific fixture evidence is `tests/unit/kiro-tool-name-cache-3107.test.js` for toolUseEvent translation and `tests/translator/kiro-tool-index.test.js` for distinct response call indexes. A new timestamp-helper unit assertion would test implementation spelling without establishing a compatibility difference.

### #4763 — narrow image capability gap

The exact head keeps three image forms for names containing `claude` and omits their attachments for non-Claude Kiro models while preserving accompanying text. The installed request translator currently attaches these supported source forms without checking the resolved Kiro model, and its current fixture set only demonstrates positive image forwarding. Thus non-Claude Kiro model routing can receive an attachment the patch explicitly filters. Disposition: **port the narrow model-capability gate**. Keep the model allow condition aligned with the installed Kiro model catalog/capabilities rather than broadening the protocol surface; do not change sign-in, provider setup, integrations, or other request affordances.

Ordinary offline acceptance for that gap: extend `tests/unit/openai-to-kiro.test.js` with matching image payloads for one Claude model and representative non-Claude Kiro model IDs, asserting Claude retains all recognized attachment shapes, non-Claude requests omit `images`, and text remains. Exercise both the direct translator contract and the resolved model identifier used by the request path. Run the focused test file from `tests/` with `node node_modules/vitest/vitest.mjs run unit/openai-to-kiro.test.js --maxWorkers=2`. No live provider traffic is needed.
