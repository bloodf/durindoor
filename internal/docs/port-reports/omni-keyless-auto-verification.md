# OmniRoute #21247: keyless auto-routing readiness verification

Read-only parity check of OmniRoute [#21247](https://github.com/cheaper-inference/OmniRoute/pull/21247), starting from [omni-review-auth-verified.md](omni-review-auth-verified.md). Worktree commit: `b45ee474182f`. No provider requests were made. The only repository write is this report; linked dependency directories were not touched.

## Result

**Candidate selection without a readiness signal is reproducible; a local user-facing defect matching #21247 is not established.** The local unscoped auto-combo catalog deliberately seats eligible no-auth providers, and its pure family resolver does not inspect provider readiness. However, #21247's runtime-dependent candidates are browser-backed providers whose executors need Playwright/Chromium. The relevant local DuckDuckGo executor makes direct HTTP requests and does not use a browser; Cloudflare Playground is not opted into the local no-auth auto-combo set. The specific “missing browser runtime causes a dead member in auto” failure from upstream therefore does not map directly to the local candidates. A dead remote service can still be selected, but chat fallback handles request-time failures; that is separate from a local runtime readiness gate.

## Upstream change

GitHub API inspection (`gh api repos/cheaper-inference/OmniRoute/pulls/21247` and `/files`) reports #21247 merged as `8255219c9406b96b2d59a285dc1472b15023d3f7`, with head `bfd1ec42a23538c48cce1dc86f6cf3570aec832a`. It addresses upstream issue #19385. Its two changes are distinct:

1. Retire UncloseAI's public keyless offer after the endpoint began returning 401, retain its free-catalog row as discontinued, and make the provider API-key-only.
2. Gate browser-backed keyless providers (`cloudflare-playground`, `duckduckgo-web`) from `auto/*` unless a boot-time Playwright/Chromium executable probe succeeds. Missing/unregistered readiness fails closed. Direct provider/model routes are unchanged.

The PR describes a host-runtime readiness test, not a provider health or remote endpoint probe. Its changed paths put the predicate in `open-sse/services/autoCombo/noAuthReadiness.ts` and candidate filtering in `virtualFactory.ts`; app instrumentation awaits the boot-time probe registration. The PR's own validation claims new base-failing tests for missing probe / missing Chromium and a negative persisted-connection probe. Its changelog references #19385. No separate local issue owner or hold for #19385 was found in the starting census; local tracking references #6557 (no-auth connection disable) and #6889 (default no-auth auto pool) are adjacent pool semantics, not browser readiness.

## Local candidate construction and readiness

- `src/sse/services/model.js:408-450` builds the catalog used by auto-combo. It includes models for active saved connections (`430-443`) and then adds eligible no-auth providers by default as synthetic seats (`444-450`). The only runtime readiness exclusion in that function is the explicit Devin CLI binary check at `451-456`.
- `open-sse/config/providers.js:7-31` defines the canonical no-auth auto-combo predicate: registry `autoComboNoAuth === true`, `noAuth === true`, free category, and LLM service eligibility. `open-sse/services/combo.js:132-165` implements the inactive-connection toggle; it does not read readiness.
- `open-sse/services/autoComboResolver.js:57-85,88-111` flattens catalog entries and selects matching family models. It has no readiness argument or readiness lookup; the `_settings` parameter is unused (`95-96`). `src/sse/services/model.js:547-560` calls it to resolve `auto/<family>`, then applies disabled-model, paid-model, and exposure filters, but no readiness filter.
- `src/sse/services/autoComboScope.js:1-16,34-79` is only applied to scoped auto-combo requests. With no API key, or no scoped auto id, it returns the pool unchanged (`35`). A non-empty connection allowlist filters candidate providers to active permitted connections (`64-79`). Thus the public synthetic no-auth seat is not a way around a scoped key's connection allowlist. `src/sse/handlers/chat/combo.js:229-236` runs this scope step after constructing the combo list; nested dispatch repeats it at `374-383`.
- Existing readiness/probing is on separate paths: `src/sse/services/keylessAvailability.js:9-24,96-113` probes keyless service availability and caches by URL, while `src/sse/services/mediaRoutes.js:6,66` consumes it for media routes. Search found no chat/auto-combo consumer. Its contract checks configured endpoint answers / local voice availability, not presence of Playwright/Chromium.
- Actual local DuckDuckGo transport is `open-sse/executors/duckduckgo-web.js:8-10,92-95,98-143`; it fetches DuckDuckGo status and chat endpoints with `sender.sendRequest`, and has no browser launch. The model `llama-4-scout` exists in `open-sse/providers/registry/duckduckgo-web.js:13-29`, and DuckDuckGo opts into the auto-combo no-auth pool at line 15. In contrast `open-sse/providers/registry/cloudflare-playground.js:14-20` has `noAuth` but no `autoComboNoAuth` opt-in, so the local no-auth gate does not seed it.

## Offline reproduction

Command (imports the production pure resolver, supplies the same relevant local registry model shape, and makes no network calls):

```sh
node --input-type=module -e 'import { resolveAutoCombo } from "./open-sse/services/autoComboResolver.js"; const catalog={ddgw:[{id:"llama-4-scout"}]}; console.log(JSON.stringify({readinessProbeRegistered:false, candidates:resolveAutoCombo("llama",catalog)}));'
```

Result:

```json
{"readinessProbeRegistered":false,"candidates":["ddgw/llama-4-scout"]}
```

Node emitted a `MODULE_TYPELESS_PACKAGE_JSON` performance warning and successfully evaluated the resolver. This isolates the no-readiness selection fact. It does not demonstrate that local DuckDuckGo requires a browser or that the provider is remotely down. A first attempt to include `applyNoAuthAutoComboGate` in this standalone command failed before execution because its dependency graph uses the app alias `open-sse/...` (`ERR_MODULE_NOT_FOUND`); it made no changes. The successful reproduction uses the actual resolver, with the candidate membership cross-checked against the registry opt-in and catalog-builder code above.

## Dispatch and fallback

`open-sse/services/combo.js:1721-1776` iterates the ordered candidates and dispatches them one at a time. A configured per-candidate timeout aborts the attempt and continues (`1735-1776`). Non-success responses and thrown provider errors flow through failure classification and fallback handling (`1783-1803`, `1969-2036`). This means a candidate can be selected before it is known to fail; that remains observable as a failed attempt/latency, but the request can continue to the next candidate. The upstream boot gate avoids the known local-process prerequisite before selection; local DuckDuckGo has no corresponding browser prerequisite.

## Disposition and scope

- **UncloseAI retirement:** already ported locally: `src/shared/constants/providers` classifies it as API-key provider and its free rows are discontinued; `tests/unit/port-omniroute-uncloseai-retired.test.js:7-21` verifies the behavior. The prior port record is `internal/docs/port-reports/1073-nov26-night-ports.md:9`.
- **Readiness parity:** no port recommended from #21247 on current evidence. A synthetic local repro proves the resolver would accept a no-auth family candidate absent readiness, but this alone is not a defect. The specific upstream runtime prerequisite is not present for local DuckDuckGo's executor, and local Cloudflare is not in the auto-combo seed pool. The local system already has an explicit Devin binary exclusion, so the general design pattern is present where a known local binary prerequisite exists (`src/sse/services/model.js:451-456`).
- **Potential follow-up:** if another `autoComboNoAuth` provider gains a host-local prerequisite (for example a browser/CLI binary), model that prerequisite explicitly at catalog construction and test both unscoped and scoped dispatch. Remote service health should remain distinct from host readiness and preserve ordinary fallback semantics.
- **Commands/results:** `git status --short` was empty before this report; bounded `rg`/`nl` inspection of the paths cited above; upstream GitHub API calls noted above; successful offline resolver command above. No tests were run because the requested task was a focused offline reproduction, and no provider calls or production changes were made.
