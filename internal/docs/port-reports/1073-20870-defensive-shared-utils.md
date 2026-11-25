# #1073 — Review existing defensive utility ownership

## Scope, Pins, and Provenance

Reviewed the defensive shared utilities bundle PR from contributor train [OmniRoute #20870](https://github.com/cheaper-inference/OmniRoute/pull/20870) (`chore(release): contributor train e1b of 21 PRs for v3.8.55 (2026-11-21)`). Dispositions are based strictly on the named PR patch at its verified public head, excluding unrelated train changes, migrations, or release scaffolding.

| PR | Title | Exact PR head | Train merge pin | Scope |
| --- | --- | --- | --- | --- |
| [OmniRoute #19724](https://github.com/cheaper-inference/OmniRoute/pull/19724) | `fix: shared utils: 4 fixes` | [`610fbaac81a2caee7815f818131dce9798b335c2`](https://github.com/cheaper-inference/OmniRoute/commit/610fbaac81a2caee7815f818131dce9798b335c2) | Contributor train [#20870](https://github.com/cheaper-inference/OmniRoute/pull/20870) | Input sanitizer encoded injection scan, circuit breaker consecutive probe recovery, custom PII regex deadline probe, and provider alias index lookup |

---

## 1. Input Sanitizer Encoded Injection Scanning (OmniRoute #19724)

### Upstream patch mechanics
In `src/shared/utils/inputSanitizer.ts`, OmniRoute #19724 addresses prompt injection evasions where directives like `"Ignore all previous instructions"` were wrapped in base64, hexadecimal, or percent-encoding:
- Previously, `detectInjection(text)` matched surface text only; encoded instructions bypassed inspection unless explicit phrasing like `"base64 decode"` was present alongside `"instruction"`.
- The fix introduces multi-layer decoding (`decodeEncodedLayers`) bounded by `MAX_DECODE_DEPTH = 2` and a byte budget `MAX_DECODE_BYTES = 8 * MAX_INJECTION_SCAN_BYTES`.
- Linear regexes identify potential candidate runs without nested quantifiers:
  - `BASE64_RUN_RE = /[A-Za-z0-9+/_-]{24,}={0,2}/g`
  - `HEX_RUN_RE = /(?:[0-9a-fA-F]{2}){12,}/g`
  - `PERCENT_RUN_RE = /(?:%[0-9a-fA-F]{2})+/g`
- Runs decoding to non-printable control characters or invalid UTF-8 (`NOT_READABLE_RE`) are dropped as binary data (hashes, keys, tokens).
- Readable decoded text layers are recursively rescanned against `INJECTION_PATTERNS`, and matching rules are reported with a `"decoded:"` prefix (e.g. `"decoded:system_override"`).
- Verified upstream in `tests/unit/input-sanitizer-encoded-injection.test.ts`.

### Local DurinDoor architecture and contracts
- **Absence of heuristic prompt injection scanner:** DurinDoor does not possess `src/shared/utils/inputSanitizer.ts` or an equivalent prompt injection inspection middleware (such as OmniRoute's `src/middleware/promptInjectionGuard.js`). As documented in earlier audits (e.g. [`1073-february-runtime-scope-2.md`](./1073-february-runtime-scope-2.md)), DurinDoor operates as a transparent proxy and translation engine (`src/`: dashboard and `/v1` gateway; `open-sse/`: translation, routing, and executors).
- **Gateway neutrality vs. prompt tampering:** DurinDoor deliberately avoids inspecting, parsing, or censoring user model prompts with heuristic regular expressions. Inspecting and blocking prompt contents creates high false-positive rates on coding, security research, and agentic workflows, while introducing significant latency and CPU overhead on large request windows.
- **Local defensive boundaries:** DurinDoor enforces defense-in-depth through structural and protocol-level protections rather than prompt heuristic filtering:
  - **Outbound credential and secret redaction:** [`open-sse/services/contentMasking.js`](../../../open-sse/services/contentMasking.js) (`maskText`, `maskRequestContent`) intercepts outbound traffic to prevent leaking upstream API keys, AWS credentials, JWTs, and private keys.
  - **Header and connection sanitation:** [`src/mitm/sanitizeHeaders.js`](../../../src/mitm/sanitizeHeaders.js) strips sensitive Hop-by-Hop and authentication headers; [`src/lib/providers/sanitizeProviderConnectionForClient.js`](../../../src/lib/providers/sanitizeProviderConnectionForClient.js) prevents credential exposure to client dashboards.
  - **Request limits and timeouts:** DurinDoor enforces hard request payload ceilings and connection deadlines (`MAX_CONNECTION_TIMEOUT_MS`) to prevent resource exhaustion without executing recursive decoding loops.

### Disposition: OmniRoute #19724 (Input Sanitizer)
**Reject / Out of scope for DurinDoor proxy core.** DurinDoor maintains a transparent proxy contract and does not inspect prompt contents for heuristic injection signatures. No local component exists or is warranted for recursive string decoding.

---

## 2. Circuit Breaker Half-Open Consecutive Probes Recovery (OmniRoute #19724)

### Upstream patch mechanics
In `src/shared/utils/circuitBreaker.ts`, OmniRoute #19724 fixes a resilience flaw in its client-side `CircuitBreaker` class:
- Previously, when a circuit breaker transitioned to `STATE.HALF_OPEN`, a single successful probe immediately transitioned the breaker to `STATE.CLOSED`, regardless of whether `halfOpenRequests` was configured to a higher threshold (e.g., 3). A flapping or intermittently failing provider could pass a single lucky probe and prematurely restore full traffic, only to immediately fail subsequent requests.
- The patch adds `halfOpenSuccesses = 0` to the breaker state.
- In `_onSuccess` under `STATE.HALF_OPEN`, it increments `this.halfOpenSuccesses++` and only executes `this._transition(STATE.CLOSED, "probe-success")` once `this.halfOpenSuccesses >= this.halfOpenRequests`.
- Any probe failure in `HALF_OPEN` immediately returns the breaker to `STATE.OPEN`.
- `halfOpenSuccesses` is reset to 0 on any state transition, as well as upon stale probe lease renewal in `_evaluateCircuit`.
- Verified upstream in `tests/unit/circuit-breaker-half-open-consecutive-probes.test.ts`.

### Local DurinDoor architecture and contracts
- **Distinct architecture:** DurinDoor does not use OmniRoute's `CircuitBreaker` utility. Instead, DurinDoor implements a specialized in-memory per-connection routing circuit state machine in [`src/lib/routing/connectionCircuitState.js`](../../../src/lib/routing/connectionCircuitState.js) (#1108) paired with [`src/lib/routing/connectionRecovery.js`](../../../src/lib/routing/connectionRecovery.js).
- **Single-flight recovery probe lease:** Rather than allowing multiple concurrent speculative probes and counting consecutive successes, DurinDoor strictly limits recovery probe concurrency to a **single in-flight request**:
  - `acquireRecoveryLease(connectionId, scope)` grants a time-bounded lease (`activeLease`) to exactly one probe request.
  - Any concurrent request arriving while the circuit is in `HALF_OPEN` with an active probe lease is refused with `{ connectionRecoveryBusy: true }` and steered to fallback connections. This prevents probe stampedes from overwhelming an unstable provider.
- **Monotonic generation fencing:**
  - Every circuit transition, manual reset (`reset()`), or cooldown deadline update increments a monotonic `_generationCounter`.
  - When a probe completes, `settleRecovery(connectionId, scope, leaseToken, outcome)` checks that `lease.generation === circuit.generation` and `lease.expiresAt > now`. If the lease timed out (`DEFAULT_LEASE_TIMEOUT_MS = 30_000`) or the connection state was reset, late completions are rejected as stale (`STALE_GENERATION` or `EXPIRED_LEASE`).
- **Account-wide precedence:** Account-level circuit locks (`SCOPE_ALL = "__all"`) strictly govern over model-specific scopes; while an account probe is in flight, competing model requests cannot dispatch.
- **Safe lease release:** Cancellations, client disconnects, and request validation errors call `releaseLease()` without penalizing provider health or falsely resetting cooldowns.
- **Headroom circuit recovery:** For RTK compression proxies, [`open-sse/rtk/headroomCircuit.js`](../../../open-sse/rtk/headroomCircuit.js) similarly implements single-probe half-open evaluation (`getHeadroomCircuitState`): once the cooldown window (`CIRCUIT_COOLDOWN_MS = 60_000`) passes, exactly one probe is permitted to re-arm or close the circuit.
- **Existing safe fixtures:** DurinDoor's circuit invariants and single-flight lease behavior are verified by [`tests/unit/connection-circuit-state.test.js`](../../../tests/unit/connection-circuit-state.test.js), [`tests/unit/1108-circuit-recovery.test.js`](../../../tests/unit/1108-circuit-recovery.test.js), and [`tests/unit/headroom-circuit.test.js`](../../../tests/unit/headroom-circuit.test.js).

### Disposition: OmniRoute #19724 (Circuit Breaker)
**Already effective via existing local architecture (single-flight lease fencing) / No port.** DurinDoor's generation-fenced single-flight lease model fundamentally prevents flapping by forbidding uncoordinated concurrent probes, rendering OmniRoute's consecutive-counter patch inapplicable.

---

## 3. PII Custom Pattern Deadline Probe (OmniRoute #19724)

### Upstream patch mechanics
In `src/shared/utils/piiCustomPatterns.ts`, OmniRoute #19724 fixes a Regular Expression Denial of Service (ReDoS) vulnerability in its custom PII pattern engine:
- OmniRoute allows dashboard operators to configure arbitrary custom regex patterns for PII detection (`src/app/api/settings/pii/test/route.ts`).
- Upstream previously relied exclusively on `safe-regex` (a static star-height validator). However, `safe-regex` does not flag overlapping alternations such as `(a|aa)+$`, which take exponential backtracking time on long runs of matching characters and can freeze the Node.js event loop.
- The patch introduces `finishesInTime(regex: RegExp): boolean`:
  - Runs the regex against seven 64-character test strings (`PROBE_RUN_CHARS = ["a", "\u00e9", "1", " ", "-", "_", "."]`, `PROBE_RUN_LENGTH = 64`) appended with an anchor mismatch `!` to force full backtracking.
  - Executes the probe within a sandboxed `node:vm` Script (`"re.lastIndex = 0; re.test(s)"`) enforcing a strict 100 ms execution ceiling (`PROBE_DEADLINE_MS = 100`).
  - If the regex exceeds the deadline, throws, or hangs, `compilePiiCustomPattern` refuses the pattern with `{ ok: false, reason: "unsafe" }`.
- Verified upstream in `tests/unit/pii-custom-pattern-deadline-probe.test.ts`.

### Local DurinDoor architecture and contracts
- **No dynamic user-submitted regexes:** DurinDoor does not provide a custom PII pattern compilation API or dashboard configuration screen for arbitrary user regexes.
- **Static, audited redaction engine:** Outbound credential and PII redaction in DurinDoor is implemented in [`open-sse/services/contentMasking.js`](../../../open-sse/services/contentMasking.js) (#1112).
- **Linear pattern safety:** All expressions in `CREDENTIAL_PATTERNS` and `PII_PATTERNS` are hard-coded, static constants designed to execute in linear time:
  - Bounded character classes with fixed repetition bounds (e.g. `\b[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,24}\b`).
  - Strict prefix anchors for API keys (`sk-ant-`, `sk-proj-`, `AKIA`, `ghp_`, `gsk_`).
  - Algorithmic checksum validation: Credit card numbers match a simple linear pattern `\b(?:\d{4}[- ]?){3}\d{4}\b` and are validated using a deterministic Luhn algorithm (`luhn(digits)`), avoiding complex regex alternations.
  - Structural token exclusion: PII matching is strictly bypassed within markdown code fences and backtick spans (`CODE_SPAN_RE`), as well as non-text parts (`data:` URLs, images, tool arguments).
- **Zero ReDoS exposure:** Because DurinDoor compiles no user-supplied regexes at runtime and relies solely on audited static patterns, the event loop cannot be blocked by catastrophic backtracking from untrusted expressions.
- **Existing safe fixtures:** Verified by [`tests/unit/content-masking.test.js`](../../../tests/unit/content-masking.test.js).

### Disposition: OmniRoute #19724 (PII Patterns)
**No port / Defense inherently guaranteed by static design.** DurinDoor avoids ReDoS by design through static, pre-audited linear patterns and the absence of arbitrary runtime regex compilation.

---

## 4. Provider Alias and ID Lookup Optimization (OmniRoute #19724)

### Upstream patch mechanics
In `src/shared/constants/providers.ts`, OmniRoute #19724 replaces a linear scan with an indexed Map:
- Previously, `getProviderByAlias(alias)` walked all provider sections (`_PROVIDER_SECTIONS`, ~380 entries) and tested each entry for matching `alias` or `id`. For unaliased entries, misses, or dynamic IDs (`openai-compatible-*`), every routing step traversed the entire catalog.
- The patch introduces a lazy singleton index `_PROVIDER_BY_KEY: Map<string, AiProviderDefinition> | null`:
  - `buildProviderByKey()` populates the map on first use, indexing each provider by both `provider.alias` and `provider.id`.
  - Keys are claimed by the first provider in section order, preserving prior precedence rules (such as `poe`).
  - `getProviderByAlias(alias)` performs an O(1) lookup: `getOrCreateProviderByKey().get(alias) ?? null`.
- Verified upstream in `tests/unit/provider-alias-index-lookup.test.ts`.

### Local DurinDoor architecture and contracts
- **Existing O(1) indexing in translation & pricing core:** In DurinDoor's high-frequency pricing and catalog resolution path ([`open-sse/providers/pricing.js`](../../../open-sse/providers/pricing.js)), an O(1) lookup table is **already constructed at module initialization**:
  ```javascript
  const ALIAS_TO_PROVIDER_ID = {};
  const PROVIDER_BY_ID = {};
  for (const entry of REGISTRY) {
    PROVIDER_BY_ID[entry.id] = entry;
    ALIAS_TO_PROVIDER_ID[entry.id] = entry.id;
    if (entry.alias) ALIAS_TO_PROVIDER_ID[entry.alias] = entry.id;
    if (entry.uiAlias && entry.uiAlias !== entry.alias) ALIAS_TO_PROVIDER_ID[entry.uiAlias] = entry.id;
    for (const a of entry.aliases || []) ALIAS_TO_PROVIDER_ID[a] = entry.id;
  }
  ```
  `resolveProviderId(providerOrAlias)` in `pricing.js` resolves via `ALIAS_TO_PROVIDER_ID[providerOrAlias] || providerOrAlias` in O(1) time.
- **Compact UI provider set:** In [`src/shared/constants/providers.js`](../../../src/shared/constants/providers.js), `AI_PROVIDERS` aggregates registered providers (~50 curated entries). `getProviderByAlias(alias)` iterates over `Object.values(AI_PROVIDERS)` to support multi-alias resolution (`provider.aliases?.includes(alias)`).
- **Prefix-aware validation:** [`src/shared/constants/providers.js`](../../../src/shared/constants/providers.js) provides `isRoutableProvider(aliasOrId)` to validate user-defined compatible prefix formats (`isOpenAICompatibleProvider`, `isAnthropicCompatibleProvider`, `isCustomEmbeddingProvider`, `isSystemoneCompatibleProvider`) without requiring static catalog membership.
- **Provider normalization:** [`src/lib/providerNormalization.js`](../../../src/lib/providerNormalization.js) (`normalizeProviderId`) combines direct key check, resolved alias, and canonical slug matching.
- **Performance footprint:** Because DurinDoor's hot request translation loop relies on `open-sse/providers/pricing.js` (which already uses precomputed hash indexes), the UI helper in `src/shared/constants/providers.js` does not constitute a routing bottleneck.

### Disposition: OmniRoute #19724 (Provider Alias Index)
**Already effective in hot path / Existing local architecture retained.** High-frequency translation and pricing resolution already use O(1) hash maps built from `REGISTRY`. `src/shared/constants/providers.js` lookup is compact and safe.

---

## 5. Dispositions Summary

| PR | Exact PR head | Train | Feature / Contract | Disposition |
| --- | --- | --- | --- | --- |
| [OmniRoute #19724](https://github.com/cheaper-inference/OmniRoute/pull/19724) | [`610fbaac81a2caee7815f818131dce9798b335c2`](https://github.com/cheaper-inference/OmniRoute/commit/610fbaac81a2caee7815f818131dce9798b335c2) | Contributor train [#20870](https://github.com/cheaper-inference/OmniRoute/pull/20870) | Input sanitizer multi-layer encoded injection scan | **Reject / Out of scope.** Transparent proxy core avoids heuristic prompt payload parsing and decode loops. |
| [OmniRoute #19724](https://github.com/cheaper-inference/OmniRoute/pull/19724) | [`610fbaac81a2caee7815f818131dce9798b335c2`](https://github.com/cheaper-inference/OmniRoute/commit/610fbaac81a2caee7815f818131dce9798b335c2) | Contributor train [#20870](https://github.com/cheaper-inference/OmniRoute/pull/20870) | Circuit breaker consecutive half-open probe recovery | **Already effective via existing local architecture.** Generation-fenced single-flight lease model prevents flapping without multi-probe counters. |
| [OmniRoute #19724](https://github.com/cheaper-inference/OmniRoute/pull/19724) | [`610fbaac81a2caee7815f818131dce9798b335c2`](https://github.com/cheaper-inference/OmniRoute/pull/20870) | Contributor train [#20870](https://github.com/cheaper-inference/OmniRoute/pull/20870) | Custom PII pattern VM deadline probe | **No port / Defense inherently guaranteed by static design.** Hard-coded linear patterns in `contentMasking.js` prevent ReDoS without runtime VM execution. |
| [OmniRoute #19724](https://github.com/cheaper-inference/OmniRoute/pull/19724) | [`610fbaac81a2caee7815f818131dce9798b335c2`](https://github.com/cheaper-inference/OmniRoute/commit/610fbaac81a2caee7815f818131dce9798b335c2) | Contributor train [#20870](https://github.com/cheaper-inference/OmniRoute/pull/20870) | Provider alias and ID O(1) map indexing | **Already effective in hot path.** `open-sse/providers/pricing.js` already uses precomputed hash maps from `REGISTRY`. |

---

## 6. Applicable Ordinary Acceptance and Safe Branch Fixtures

1. **Circuit breaker single-flight lease fencing:**
   - [`tests/unit/connection-circuit-state.test.js`](../../../tests/unit/connection-circuit-state.test.js) verifies that half-open circuits admit only one concurrent probe lease, rejecting competing requests with `connectionRecoveryBusy`.
   - [`tests/unit/1108-circuit-recovery.test.js`](../../../tests/unit/1108-circuit-recovery.test.js) verifies generation fencing across manual resets, ensuring stale probe completions cannot alter circuit state.
   - [`tests/unit/headroom-circuit.test.js`](../../../tests/unit/headroom-circuit.test.js) verifies that RTK Headroom recovery permits exactly one probe upon cooldown expiry before re-evaluating state.
2. **Static content masking and credential protection:**
   - [`tests/unit/content-masking.test.js`](../../../tests/unit/content-masking.test.js) verifies that credential patterns (OpenAI, Anthropic, AWS, Stripe) and PII patterns (email, SSN, CPF, Luhn-checked card) are masked using linear, non-backtracking rules while preserving code blocks and binary payloads untouched.
3. **Provider alias and identity resolution:**
   - [`src/shared/constants/providers.js`](../../../src/shared/constants/providers.js) and [`open-sse/providers/pricing.js`](../../../open-sse/providers/pricing.js) preserve stable resolution of canonical provider IDs and alias lookups.
4. **Zero live provider exposure:**
   - All defensive evaluations are performed strictly via static code inspection and safe mock branch fixtures without live target calls, credential access, Docker containers, or exploit execution.
