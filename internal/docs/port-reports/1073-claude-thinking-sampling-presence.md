# 1073: Claude thinking sampling presence

Disposition: **already covered; no product change.**

Source inspected 2026-11-20: [OmniRoute #18639](https://github.com/cheaper-inference/OmniRoute/pull/18639), merged 2026-11-02, final head `90561d18822577a2cfd8eec255f8bd92be96087d`, merge commit `cc1022dcb1714ecf18abea6bdf3a07a784023712`. Changed files: `open-sse/services/claudeCodeConstraints.ts`, a changelog fragment and one unit test.

## Upstream contract

`enforceThinkingTemperature` set `temperature = 1` on every thinking-enabled (`enabled` or `adaptive`) Claude body. That re-added a field an operator filter or built-in strip rule had removed, and invented one when the client sent none. The fix pins only when `temperature` or `top_p` is present:

- temperature present: pinned to 1, `top_p` dropped (unchanged);
- lone `top_p`: converted to the pinned branch (unchanged);
- neither present: nothing injected;
- thinking off: untouched.

## DurinDoor comparison

DurinDoor has no `claudeCodeConstraints` module and no code that writes `temperature = 1`. The relevant paths:

- `open-sse/translator/request/openai-to-claude.js`: copies `temperature` only when the caller sent it (`!== undefined`). It does not translate `top_p`. Its `finalize` hook runs after `applyThinking` (`open-sse/translator/index.js`) and deletes `temperature` when thinking is not `disabled`. Local policy therefore removes explicit temperature under thinking on this route; it does not rewrite it to 1.
- `open-sse/translator/concerns/paramSupport.js` `STRIP_RULES`: `/claude/i` drops `temperature`; `claude-opus-5[-.]5` also drops `top_p` and `top_k`. `DefaultExecutor.transformRequest` applies `stripUnsupportedParams` (`open-sse/executors/default.js`) as the final wire filter. Rules only delete present fields.
- Responses → Claude (pivot through the `openai:claude` translator, no `finalize` capture) and native Claude → Claude pass an explicit `temperature` through translation unchanged. The executor strip rule removes it on the wire for every Claude model id.

So the upstream defect (injection of a filtered or absent field) has no local counterpart: no step after the filter re-adds a sampling field, and absent fields stay absent.

## Verified shapes

`tests/unit/omni-claude-thinking-sampling-presence.test.js` runs offline, with placeholder credentials and no network. For `claude-haiku-4-5-20251001`, `claude-opus-4-6`, `claude-opus-5` and `claude-opus-5-5`, on providers `anthropic` and `claude`:

- Chat Completions, Responses and native Claude bodies with thinking active and no sampling fields: translated and executor wire bodies contain no `temperature`, `top_p` or `top_k` keys.
- Explicit sampling: direct Chat → Claude removes `temperature` under active thinking; the executor never emits `temperature` for a Claude model; `top_p` and `top_k` survive on `claude-opus-5` and drop on `claude-opus-5-5`.
- Disabled thinking (`reasoning_effort: "none"`, native `{type: "disabled"}`) and no-thinking requests keep an explicit `temperature` (and native `top_p`) on the direct route.

Existing neighbours still pass together with the new file: `tests/translator/port-1264-claude-thinking-temperature.test.js` and `tests/unit/claude-opus-5-5.test.js` (37 tests across the three files).

## Rejected alternatives

- Adding a `temperature = 1` pin: DurinDoor removes temperature instead, which Anthropic also accepts under thinking, and adding a pin would introduce the injection bug upstream just fixed.
- Rewriting a lone `top_p` to `temperature = 1`: it would create a sampling field the caller never sent and no local code does it.

## Limits

Offline translation and executor request shapes only. No provider call, credential or live model acceptance was exercised. Dependencies were installed privately and are git-ignored; no lockfile, baseline file, workflow or `AGENTS.md` was touched.
