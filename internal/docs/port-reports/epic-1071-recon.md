# Epic #1071 recon: browser and session provider ports

Checked 2026-11-26 against branch `orq/tows9a/recon-1071-a1-l2` (base `05fab74f232`). Source of the checklist: bloodf/durindoor issue #1071 body, 17 unchecked `port(omniroute)` items. Read-only: no product code, tests or issues were changed.

Method: for each item, the provider id was located in `open-sse/providers/registry/` and `registry/index.js`, then checked for an executor under `open-sse/executors/`, a unit test, a public page under `docs/providers/`, and the first landing commit of the registry file. Presence means the provider is wired and tested locally. It does not prove live operation, which the epic itself says tests cannot show.

Summary: 17 unchecked items. Present 17, not applicable 0, missing 0.

## Checklist

| Issue | Item | Status | Evidence or gap |
| --- | --- | --- | --- |
| #1159 | evaluate and add blackbox-web provider | present | Registry `open-sse/providers/registry/blackbox-web.js`, executor `open-sse/executors/blackbox-web.js`, test `tests/unit/blackbox-web-provider.test.js`, page [Blackbox Web](../../../docs/providers/blackbox-web.mdx). Landed in `49b5c37014f` (#2328). |
| #1162 | evaluate and add chatgpt-web-codex provider | present | Registry `open-sse/providers/registry/chatgpt-web-codex.js`, executor `open-sse/executors/chatgpt-web-codex.js`, tests `tests/unit/chatgpt-web-codex-provider.test.js` and `tests/unit/fleet-provider-chatgpt-web-codex-acceptance.test.js`, page [ChatGPT Web Codex](../../../docs/providers/chatgpt-web-codex.mdx). Landed in `5118b2bb24f` (#2323). Cycle contract lists it as in flight with an existing owner; not reopened here. |
| #1163 | evaluate and add chatplayground provider | present | Registry `chatplayground.js`, executor `chatplayground.js` plus `chatplaygroundStream.js`, tests `chatplayground-provider.test.js`, `port-omni-20375-chatplayground-unified-api.test.js`, `review-x-chatplayground.test.js`, page [ChatPlayground](../../../docs/providers/chatplayground.mdx). Landed in `5118b2bb24f`, later reworked (`ef0dd330cf6`). |
| #1165 | evaluate and add claude-web provider | present | Registry `claude-web.js`, executor `claude-web.js`, page [Claude Web](../../../docs/providers/index.mdx) card. Landed in `5118b2bb24f`. Gap: no dedicated `claude-web` unit test file; coverage is by translator tests that name the provider. |
| #1167 | evaluate and add cloudflare-playground provider | present | Registry `cloudflare-playground.js`, executor `cloudflare-playground.js`, tests `cloudflare-playground-provider.test.js` and `port-omni-18313-cloudflare-playground-tools.test.js`, page [Cloudflare AI Playground](../../../docs/providers/cloudflare-playground.mdx). Landed in `5118b2bb24f`. |
| #1169 | evaluate and add conol-web provider | present | Registry `conol-web.js`, executor `conol-web.js`, test `conol-web-provider.test.js`, page [Conol Web](../../../docs/providers/conol-web.mdx). Landed in `49b5c37014f`. Residual, stated in the page: no session continuity and no advanced multimodal uploads from OmniRoute. |
| #1173 | evaluate and add deepseek-web provider | present | Registry `deepseek-web.js`, executor `deepseek-web.js`, tests under `tests/translator/` and `tests/unit/` (for example `deepseek-claude-tools.test.js`, `deepseek-v4-thinking.test.js`), page [DeepSeek Web](../../../docs/providers/deepseek-web.mdx). Landed in `5118b2bb24f`, later changed in `43215751f72`. |
| #1176 | evaluate and add doubao-web provider | present | Registry `doubao-web.js`, executor `doubao-web.js`, test `doubao-web-provider.test.js`, page [Doubao Web](../../../docs/providers/doubao-web.mdx). Landed in `5118b2bb24f`. |
| #1190 | evaluate and add gemini-web provider | present | Registry `gemini-web.js`, executors `gemini-web.js` and `gemini-web-dom.js`, about seven test files referencing it (largest reference count of the set), page [Gemini Web](../../../docs/providers/gemini-web.mdx). Landed in `5118b2bb24f`. Cycle contract lists it as in flight with an existing owner; not reopened here. |
| #1198 | evaluate and add lmarena provider | present | Registry `lmarena.js`, executor `lmarena.js`, tests `lmarena-provider.test.js` and `review-b-lmarena-stream.test.js`, page [Arena](../../../docs/providers/lmarena.mdx). Landed in `5118b2bb24f`. |
| #1202 | evaluate and add maxai provider | present | Registry `maxai.js`, executor `maxai.js`, test `maxai-provider.test.js`, page [MaxAI](../../../docs/providers/maxai.mdx). Landed in `5118b2bb24f`. Residual, stated in the page: the web stream reports no usage, and tool calling and vision differ by model. |
| #1214 | evaluate and add notion-web provider | present | Registry `notion-web.js`, executor `notion-web.js`, test `notion-web-provider.test.js`, page [Notion AI Web](../../../docs/providers/notion-web.mdx). Landed in `49b5c37014f`. |
| #1215 | evaluate and add notrack-web provider | present | Registry `notrack-web.js`, executor `notrack-web.js`, tests `notrack-web-provider.test.js` and `notrack-optional-session-cookie.test.js`, page [NoTrack Web](../../../docs/providers/notrack-web.mdx). Landed in `49b5c37014f`. The API-key `notrack` provider is a separate, present integration. |
| #1236 | evaluate and add tencent-aistudio-web provider | present | Registry `tencent-aistudio-web.js`, executor `tencent-aistudio-web.js`, test `tencent-aistudio-web-provider.test.js`, page [Tencent AI Studio Web](../../../docs/providers/tencent-aistudio-web.mdx). Landed in `49b5c37014f`. Residual, stated in the page: capture profile is unverified. |
| #1237 | evaluate and add tinycms-web provider | present | Registry `tinycms-web.js`, executor `tinycms-web.js`, tests `tinycms-web-provider.test.js` and `review-w-tinycms-secret.test.js`, page [TinyCMS Web](../../../docs/providers/tinycms-web.mdx). Landed in `49b5c37014f`. |
| #1241 | evaluate and add uc provider | present | Registry `open-sse/providers/registry/uc-direct.js` (id `uc-direct`, alias `ucd`, `apikey`, passthrough models, catalog entry in `docs/providers/catalog.mdx`). Test coverage in `tests/unit/omniroute-simple-providers-b3c.test.js` and the baselines. Landed in `790cbbfb9dc` (#1492), before this epic. Gap: no `docs/providers/` page and no executor (uses the generic OpenAI path). |
| #1251 | evaluate and add zai-web provider | present | Registry `zai-web.js`, executor `zai-web.js`, tests `fleet-provider-zai-web-acceptance.test.js` and `mcp-zai-provider-connection.test.js`, page [Z.ai Web](../../../docs/providers/zai-web.mdx). Landed in `5118b2bb24f`. Cycle contract lists it as in flight with an existing owner; not reopened here. |

## Not applicable and missing

None. No item is out of scope under the plan rules, and no checklist provider lacks a registry entry.

## Follow-ups (not ports)

- `uc-direct`: add a `docs/providers/` page or leave as catalog-only. Choose at the port unit.
- `claude-web`: add a dedicated provider test. Its current coverage is translator-level.
- Residual gaps above (conol-web sessions and uploads, maxai usage, tencent capture) belong to the provider owners. They are not reopened by this recon.
