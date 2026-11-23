# #1072: 9router master commits since v0.5.119 (2026-11-23)

| Commit | Title | Date | Disposition | Evidence |
| --- | --- | --- | --- | --- |
| [e180e7520e](https://github.com/decolua/9router/commit/e180e7520e6b6c48900b8193b7164ecbf0e822ba) | chore(deps): bump next toolchain, node-forge and vitest | 2026-11-19 | not applicable | Dependency-only update. |
| [c0feb3a018](https://github.com/decolua/9router/commit/c0feb3a0183e66dcfdfa73ac70ad18c333c95c47) | chore(i18n): translate leftover Vietnamese strings and comments to English | 2026-11-19 | not applicable | Translation and comment changes only. |
| [d1970ac915](https://github.com/decolua/9router/commit/d1970ac91561a8f4224cbfef7921dc8ee7dc7c5c) | Bump version | 2026-11-13 | not applicable | Upstream version bump only. |
| [fdd942de8a](https://github.com/decolua/9router/commit/fdd942de8af60c64c9dc9cf83767cf22f16ca842) | feat(token-saver): add REA allow prompt toggle | 2026-11-19 | not applicable | The toggle removes security-policy paragraphs from client system prompts. The work order preserves main security rules. |
| [db83e88bd0](https://github.com/decolua/9router/commit/db83e88bd0e9b0962bdaaa7e188dde93ca606c4c) | feat(providers): add OpenDesign Go and DeepRelay with quota tracking | 2026-11-13 | ported | Registry transports and quotas added; Synthetic retains its newer weekly-first behavior and also reports hourly search. Control keys use encrypted provider-specific storage and are stripped from responses. See `tests/unit/port9r-gateway-quotas-db83e88.test.js`. |
| [dbe446d05f](https://github.com/decolua/9router/commit/dbe446d05ff2c4b5221dba2685c7545121346a01) | fix(providers): Alibaba Token Plan dual-endpoint + usage accounting | 2026-11-16 | ported | Native Alibaba and QwenCloud transports, model capabilities and split-cache accounting are covered by `tests/unit/port9r-alibaba-token-plan-dbe446d.test.js`; the existing `qwen-cloud` identity remains separate. |

OpenDesign quota reads use `providerSpecificData.opendesignControlKey`; optionally set `opendesignWorkspaceId` when the key sees multiple workspaces. The runtime API key cannot read the control-plane quota.

The frozen alias baseline reports changed provider IDs and model keys after adding these providers. The work order prohibits updating `tests/__baseline__/`, so that check requires an owner-managed baseline update.
