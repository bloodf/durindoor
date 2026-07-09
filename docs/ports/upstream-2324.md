# Port log: upstream 9router PR #2324

- **Source:** decolua/9router#2324
- **Upstream title:** fix(cli): stop Headroom proxy on shutdown and before npm upgrade (EBUSY #2265)
- **Lock SHA:** `a3c97f2a49910278081dfcf1c9d6f847d2da6d6d` (origin/dev)
- **Port branch:** `port/upstream-2324-a3c97f2`

## Status: already-landed

At the lock SHA, all functional changes from the upstream PR are already present in the DurinDoor fork:

| Upstream change | Already present in DurinDoor |
| --- | --- |
| Headroom proxy PID-file shutdown in CLI | `cli/cli.js` (`killByPidFile(...headroom/proxy.pid)`) |
| MITM root CA auto-generation | `src/mitm/cert/rootCA.js` (`ensureRootCASync`), `src/mitm/server.js` |
| MITM `startServer()` concurrent-start guard | `src/mitm/manager.js` (`mitmStarting` + cross-process `LOCK_FILE`) |
| Claude model ID dot-to-dash for Kiro | `open-sse/config/kiroConstants.js` (`toKiroModelId`) and Kiro translators |
| System-message wrapper for Kiro | `open-sse/translator/request/openai-to-kiro.js` uses `<instructions>` wrapper (DurinDoor's adaptation of the upstream `<system-reminder>` change) |
| Google TTS long-text chunking | `open-sse/handlers/ttsProviders/googleTts.js` (`chunkText`, `extractBase64`) |
| Antigravity trailing assistant prefill strip | `open-sse/translator/request/openai-to-claude.js` |
| Strip Responses-API-only fields | `open-sse/translator/request/openai-responses.js` (`delete client_metadata/background/truncation`) |
| Gemini `multipleOf` schema stripping | `open-sse/translator/formats/gemini.js` |
| `claude-sonnet-5` entries and NVIDIA minimax-m2.7 thinking disable | `open-sse/providers/capabilities.js`, `open-sse/providers/registry/*.js` |

## Fork-only touchpoints preserved

- `custom-server.js`, `captain-definition`, `gitbook/` content, started config, and tooling flags were not modified.
- DurinDoor-specific model aliases and capability variants (e.g. `claude-fable-5`, `claude-sonnet-5-thinking-agentic`) remain in place.

## Verification

- `node -c src/mitm/server.js`
- `node -c src/mitm/manager.js`
- `cd tests && npx vitest run --config vitest.config.js unit/mitm-rootca-autogen.test.js` — 5 passed

No runtime behavior changes are introduced by this port commit.
