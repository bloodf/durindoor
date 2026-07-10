# Dev zero-test recovery

This stage started from verified `dev@6457d95dd5e16e25cdd758d32dad904d16390256`
after the Stage 1 CI recovery and consolidated Gitlawb cleanup. It removes the
remaining failure baseline and records the product contracts used to decide
whether each failure required a runtime fix or an assertion update.

## Runtime contracts recovered

- Kiro receives the resolved catalog model ID unchanged. Synthetic
  `-thinking` and `-agentic` suffixes are removed, but Claude version dots such
  as `claude-sonnet-4.5` remain on the wire. Dashed client aliases are still
  accepted by model normalization. This follows live-validated OmniRoute
  PR #6170 and the current OmniRoute/9router implementations; the conflicting
  dash-conversion experiments were not merged.
- AgentRouter uses one Claude `/v1/messages` transport with `x-api-key`, the
  Claude overlay, passthrough model IDs, and its 128k default context. A mixed
  OpenAI/Claude transport patch from PR #126 was rejected because it did not
  match the source provider or select a runtime transport safely.
- Command Code validation uses `deepseek/deepseek-v4-flash` through an explicit
  registry `validationModelId`. Both `command-code` and legacy `commandcode`
  IDs keep their existing runtime compatibility.
- GitLab Duo resolves instance URLs in this order: saved connection value,
  `GITLAB_DUO_BASE_URL`, legacy `GITLAB_BASE_URL`, then `gitlab.com`.
- Static no-auth catalogs remain visible when unrelated connections exist.
  Pollinations prefers a real saved key, falls back once to a synthetic public
  credential, and stops when that fallback is excluded. Public placeholders
  are never forwarded as bearer tokens. Premium-only Pollinations IDs are
  omitted without a real key.
- Suggested OpenAI-compatible catalogs retain opaque chat model IDs and reject
  only explicit non-chat families. The server-side fetch route accepts only
  exact registry-declared `(URL, filter type)` pairs and refuses redirects, so
  the dashboard cannot turn it into an SSRF proxy.
- Api.airforce validation uses the canonical registry probe and its
  `validateUrl`; a stale source-regex test was replaced with behavior coverage.
- Copilot Web, M365 Copilot, VeoAI Free, and ZenMux Free resolve to their
  specialized executors under canonical IDs and supported aliases. Veo video
  routing is exposed only after its concrete executor is registered. Copilot
  Web has the source-declared HTTP proxy agent dependency, time-bounded
  event-loop-friendly hashcash solving, and no token-keyed session cache.
  M365 accepts only the official `substrate.office.com` WebSocket host and a
  strict `<user-oid>@<tenant-id>` path, and treats a pre-completion close as an
  upstream failure.
- ZenMux sends its cookie and `ctoken` only to the upstream fetch. Executor
  diagnostics return a credential-free URL and redacted headers. The central
  request logger also redacts authorization, cookies, API keys, token headers,
  response cookies, and sensitive query parameters. Client aborts cancel the
  upstream reader and propagate as cancellations in both streaming and
  non-streaming modes; they are never reclassified as provider failures.
- Dual-auth no-auth providers render both public proxy configuration and saved
  connections, so Pollinations users can add the optional premium API key.

## PR #126 patch-bank disposition

- Retained and improved: generic no-auth model visibility and ZenMux executor
  registration.
- Rewritten: AgentRouter assertions, suggested-model filtering, Pollinations
  optional-key fallback, and web-session executor routing.
- Already landed: Api.airforce `validateUrl` behavior in the canonical provider
  probe.
- Rejected: baseline additions, the positive chat-model allowlist, edits to an
  unused validation helper, generated-index naming workarounds, and the broken
  AgentRouter multi-transport design.

## Acceptance contract

`tests/__baseline__/known-fails.txt` contains no entries. Direct Vitest and the
fail-closed JSON/JUnit runner must exit zero under Node `20.20.2` and npm
`10.8.2`, with disposable `HOME` and `DATA_DIR`. The runner must report zero
raw failures, zero known failures, and zero stale entries. Nightly and release
jobs use the same locked installs and cannot publish after a failed gate.

This stage adds no database migration and does not rewrite, rotate, expose, or
change the accepted wire shapes of stored API-key secrets.
