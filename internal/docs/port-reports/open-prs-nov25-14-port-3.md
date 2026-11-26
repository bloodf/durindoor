# Open upstream PR ports, rows 521–560, batch 3

Scope: port candidates 17–24 of [the rows 521–560 dispositions](open-prs-nov25-14.md), counted among port-candidate rows in table order.
The source report has 23 port-candidate rows, so this batch has seven rows: candidates 17–23.
Result: four rows ported in this change, three rows already present.

The head and file list of each PR were fetched with `gh api repos/decolua/9router/pulls/<N>` and `/files` on 2026-11-25.
All seven heads match the SHAs in the source report. Every earlier commit named in the main table as local evidence is an ancestor of this branch.

| Row | Repo | PR | Final disposition | Evidence |
|---:|---|---:|---|---|
| 547 | decolua/9router | [#3325](https://github.com/decolua/9router/pull/3325) | ported in this change | [base.js](../../../open-sse/executors/base.js) stripped only top-level fields after a rejection. It now also retries without a rejected assistant-message field, using `findRejectedMessageField` in [providerFieldStrips.js](../../../open-sse/config/providerFieldStrips.js). Covered by [port-3325-rejected-message-field.test.js](../../../tests/unit/port-3325-rejected-message-field.test.js). |
| 548 | decolua/9router | [#3321](https://github.com/decolua/9router/pull/3321) | already present | The client fingerprint, the per-request session and `x-real-ip` forwarding are in [opencode.js](../../../open-sse/executors/opencode.js), which sends a newer v2 `User-Agent`. Covered by [port-3321-opencode-ua-client-ip.test.js](../../../tests/unit/port-3321-opencode-ua-client-ip.test.js) and [opencode-anonymous-session-isolation.test.js](../../../tests/unit/opencode-anonymous-session-isolation.test.js). The remaining hunks are not applicable. See the section below. |
| 552 | decolua/9router | [#3314](https://github.com/decolua/9router/pull/3314) | already present | In [sqliteRuntime.js](../../../cli/hooks/sqliteRuntime.js), startup does not install `better-sqlite3` in the blocking path, an explicit install is limited to 30 seconds, and the pinned version is newer than upstream's. [postinstall.js](../../../cli/hooks/postinstall.js) installs nothing, where upstream installs there; the launcher installs the module in the background after the server is up. Covered by [port-3314-cli-no-native-sqlite.test.js](../../../tests/unit/port-3314-cli-no-native-sqlite.test.js). |
| 554 | decolua/9router | [#3311](https://github.com/decolua/9router/pull/3311) | ported in this change | Test Connection already used the region URL, and the new-key check in [the validate route](../../../src/app/api/providers/validate/route.js) already accepted a 403. Test Connection in [testUtils.js](../../../src/app/api/providers/[id]/test/testUtils.js) still reported a 403 as an invalid key. Upstream accepts every status except 401; this change adds only 403, so 500 stays a failure. Covered by [port-3311-xiaomi-tokenplan-test-connection.test.js](../../../tests/unit/port-3311-xiaomi-tokenplan-test-connection.test.js). |
| 555 | decolua/9router | [#3310](https://github.com/decolua/9router/pull/3310) | already present | Commit `586c54aab65` (`port(upstream): #3310`, DurinDoor #522). [toolCall.js](../../../open-sse/translator/concerns/toolCall.js) normalizes missing, empty and object arguments, and [capabilities.js](../../../open-sse/providers/capabilities.js) marks the Token Plan V2.5 models text-only. The Claude alias keeps its own context and output limits, as that commit set them. Covered by [tool-call-arguments.test.js](../../../tests/unit/tool-call-arguments.test.js). |
| 558 | decolua/9router | [#3259](https://github.com/decolua/9router/pull/3259) | ported in this change | [auth.js](../../../src/sse/services/auth.js) replaced an explicit `0` with the default, and both provider forms saved `0` as `3`. A provider override of `0` now keeps the current account until it is unavailable. Covered by [port-3259-sticky-limit-zero.test.js](../../../tests/unit/port-3259-sticky-limit-zero.test.js) and [port-3259-sticky-limit-zero-ui.test.js](../../../tests/unit/port-3259-sticky-limit-zero-ui.test.js). The rest of the PR is not applicable. See the section below. |
| 560 | decolua/9router | [#3250](https://github.com/decolua/9router/pull/3250) | ported in this change | Commits `62ea942d546` (DurinDoor #520) and `75ad5563c99` (DurinDoor #828) already provide the usage handler and the spent-key check. The parser in [opencode-go.js](../../../open-sse/services/usage/opencode-go.js) dropped any window other than rolling, weekly and monthly, so a spent new window did not set `limitReached`. Covered by [port-3250-opencode-go-unknown-window.test.js](../../../tests/unit/port-3250-opencode-go-unknown-window.test.js) and [opencode-go-usage.test.js](../../../tests/unit/opencode-go-usage.test.js). |

## Row 547 limits

Only `reasoning_content`, `reasoning`, `reasoning_details`, `encrypted_content`, `refusal` and `annotations` can be dropped, and only from assistant turns.
Upstream drops any field name it can read from the error, from every message.
A 422 is trusted only for a structured `extra_forbidden` path, because its text may repeat user content.
Of upstream's text patterns, only the `messages.N : property 'x' is unsupported` form is matched.

Upstream's process-wide blocklist per provider and model is not carried.
The retry stays within one request, like the existing top-level strip, so a strict upstream costs one extra attempt on each affected request.

## Row 548 hunks not carried

| Upstream hunk | Result | Evidence |
|---|---|---|
| Manual direct or proxy egress switch | not applicable | Proxy re-egress. `open-sse/utils/ocEgress.js` is absent. |
| Public IP lookup for local clients | not applicable | It calls three third-party services. The PR's own comment says the CDN in front of OpenCode replaces a client-supplied `x-real-ip`. |
| `max` thinking level for every `codebuddy-cn` model | not applicable | [thinkingLevels.js](../../../open-sse/providers/thinkingLevels.js) declares a set per model from the server's published product configuration. A provider-wide rule would add `max` to models whose published set lacks it. Models with no published set keep the `openai` default, which stops at `xhigh`. |

## Row 558 hunks not carried

The other changed paths rename the author's fork: package name, data directory, port, user agent and default URLs. They do not change gateway behaviour.
The upstream forms also change the displayed default to `0`; DurinDoor keeps `1`.
The global `stickyRoundRobinLimit` setting still requires at least `1` in [settingsSchema.js](../../../src/lib/settings/settingsSchema.js), so `0` is a per-provider value.
Combo sticky limits are a separate setting and are unchanged.
