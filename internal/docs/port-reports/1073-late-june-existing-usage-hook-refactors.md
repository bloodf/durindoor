# #1073: Late-June existing usage hook refactors and quota/cost settlement seams

## Scope and exact pins

This review audits four late-June OmniRoute pull requests from the `#3501` `chatCore` decomposition series against current DurinDoor reservation, settlement, usage, and cost accounting boundaries. The source patches were inspected statically alongside checked-in offline fixtures. In each case, the enclosing squash merge into upstream `release/v3.8.35` produces a tree diff-identical to the respective PR head commit.

| Source PR | Exact PR head | Immediate base | Enclosing merge | Landed patch scope |
| --- | --- | --- | --- | --- |
| [OmniRoute #4779](https://github.com/cheaper-inference/OmniRoute/pull/4779) | [`c2f75721c0fad9b7860ccc0b26ef025cf405f36a`](https://github.com/cheaper-inference/OmniRoute/commit/c2f75721c0fad9b7860ccc0b26ef025cf405f36a) | `89aa09f6dfc0b25d33238dbb2394e3968e8ab756` | [`fb44bbcbb9dd51c09ecb06847d99ebf048eeadd6`](https://github.com/cheaper-inference/OmniRoute/commit/fb44bbcbb9dd51c09ecb06847d99ebf048eeadd6) | `open-sse/handlers/chatCore.ts`, `open-sse/handlers/chatCore/contextEditingTelemetry.ts`, `tests/unit/chatcore-context-editing-telemetry.test.ts` (`+147 / -25`) |
| [OmniRoute #4780](https://github.com/cheaper-inference/OmniRoute/pull/4780) | [`d66a2545fc079396c96be86bd755c8b63689a304`](https://github.com/cheaper-inference/OmniRoute/commit/d66a2545fc079396c96be86bd755c8b63689a304) | `d4a0b8d0a2ad5f3ce48f2e68b4764037b3715c51` | [`326c61e4c7256872e343e6fce4dc861d590122e2`](https://github.com/cheaper-inference/OmniRoute/commit/326c61e4c7256872e343e6fce4dc861d590122e2) | `open-sse/handlers/chatCore.ts`, `open-sse/handlers/chatCore/quotaShareConsumption.ts`, `tests/unit/chatcore-quota-share-consumption.test.ts` (`+122 / -17`) |
| [OmniRoute #4784](https://github.com/cheaper-inference/OmniRoute/pull/4784) | [`82dc7d14e0c4905da06c3cbaacbac055ff8c7469`](https://github.com/cheaper-inference/OmniRoute/commit/82dc7d14e0c4905da06c3cbaacbac055ff8c7469) | `2566f44f6083e63d7991ca16aac26d474010fa6c` | [`2e0654950dcafb0f556217324bc9d2c081a83444`](https://github.com/cheaper-inference/OmniRoute/commit/2e0654950dcafb0f556217324bc9d2c081a83444) | `open-sse/handlers/chatCore.ts`, `open-sse/handlers/chatCore/streamingQuotaShare.ts`, `tests/unit/chatcore-streaming-quota-share.test.ts` (`+151 / -23`) |
| [OmniRoute #4790](https://github.com/cheaper-inference/OmniRoute/pull/4790) | [`5bbce0a2ff18abf3cacef9376a4589682d98d52a`](https://github.com/cheaper-inference/OmniRoute/commit/5bbce0a2ff18abf3cacef9376a4589682d98d52a) | `65c127278db2af2366e941629587c657e139144a` | [`1304333a5dc54408a13ae818e6d5889f72cd15d4`](https://github.com/cheaper-inference/OmniRoute/commit/1304333a5dc54408a13ae818e6d5889f72cd15d4) | `open-sse/handlers/chatCore.ts`, `open-sse/handlers/chatCore/streamingCost.ts`, `tests/unit/chatcore-streaming-cost.test.ts` (`+137 / -7`) |

### Provenance and tree relationship

- Each inspected pull request extracted an inline hook from `open-sse/handlers/chatCore.ts` into a dedicated leaf helper module under `open-sse/handlers/chatCore/` accompanied by unit characterization tests.
- Comparing each PR head directly against its enclosing squash merge (`c2f75721c0fad9b7860ccc0b26ef025cf405f36a..fb44bbcbb9dd51c09ecb06847d99ebf048eeadd6`, `d66a2545fc079396c96be86bd755c8b63689a304..326c61e4c7256872e343e6fce4dc861d590122e2`, `82dc7d14e0c4905da06c3cbaacbac055ff8c7469..2e0654950dcafb0f556217324bc9d2c081a83444`, and `5bbce0a2ff18abf3cacef9376a4589682d98d52a..1304333a5dc54408a13ae818e6d5889f72cd15d4`) yields an empty tree diff (`delta-0`).
- No extraneous merge-train modifications or unrelated PR commits were carried by these enclosing merges.

---

## Summary of dispositions

| Source PR | Subject | Disposition |
| --- | --- | --- |
| [OmniRoute #4779](https://github.com/cheaper-inference/OmniRoute/pull/4779) | `refactor(chatCore): extrai recordContextEditingTelemetryHook (#3501)` | **Upstream leaf refactor of source-specific telemetry; do not port.** DurinDoor's RTK compression and token saver analytics operate independently. |
| [OmniRoute #4780](https://github.com/cheaper-inference/OmniRoute/pull/4780) | `refactor(chatCore): extrai scheduleQuotaShareConsumption (POST-hook não-streaming, #3501)` | **Upstream leaf refactor of source-specific quota-share post-hook; do not port.** DurinDoor manages non-streaming quota settlement through reservation ticket lifecycles and usage repo persistence. |
| [OmniRoute #4784](https://github.com/cheaper-inference/OmniRoute/pull/4784) | `refactor(chatCore): extrai scheduleStreamingQuotaShareConsumption (POST-hook streaming, #3501)` | **Upstream leaf refactor of source-specific streaming quota-share post-hook; do not port.** DurinDoor manages streaming quota settlement through stream completion hooks and reservation tickets. |
| [OmniRoute #4790](https://github.com/cheaper-inference/OmniRoute/pull/4790) | `refactor(chatCore): extrai recordStreamingCost (custo por-request streaming, #3501)` | **Upstream leaf refactor of decoupled streaming cost hook; do not port.** DurinDoor handles per-request streaming cost via unified pricing breakdown and atomic usage history settlement. |

---

## 1. OmniRoute #4779 — `recordContextEditingTelemetryHook` extraction

### Exact pins

- PR: [OmniRoute #4779](https://github.com/cheaper-inference/OmniRoute/pull/4779)
- Exact head: [`c2f75721c0fad9b7860ccc0b26ef025cf405f36a`](https://github.com/cheaper-inference/OmniRoute/commit/c2f75721c0fad9b7860ccc0b26ef025cf405f36a)
- Enclosing merge: [`fb44bbcbb9dd51c09ecb06847d99ebf048eeadd6`](https://github.com/cheaper-inference/OmniRoute/commit/fb44bbcbb9dd51c09ecb06847d99ebf048eeadd6)

### Upstream contract

The patch moves an inline context-editing telemetry block from the non-streaming success path of `handleChatCore` into `open-sse/handlers/chatCore/contextEditingTelemetry.ts`:

```ts
export function recordContextEditingTelemetryHook(args: {
  contextEditingEnabled: boolean;
  provider: string | null | undefined;
  responseBody: unknown;
  skillRequestId: string;
  log?: LoggerLike;
}): void {
  const { contextEditingEnabled, provider, responseBody, skillRequestId, log } = args;
  if (!contextEditingEnabled || provider !== "claude") return;

  void (async () => {
    try {
      const { extractContextEditingTelemetry } = await import("../../config/contextEditing.ts");
      const tele = extractContextEditingTelemetry(responseBody);
      if (tele) {
        const { recordContextEditingTelemetry } = await import("@/lib/db/compressionAnalytics");
        recordContextEditingTelemetry(skillRequestId, tele, provider);
        log?.debug?.(
          "CONTEXT_EDITING",
          `cleared ${tele.clearedInputTokens} input tokens / ${tele.clearedToolUses} tool uses (${tele.editCount} edits)`
        );
      }
    } catch {
      // Telemetry is best-effort and must never affect the response.
    }
  })();
}
```

The hook is a fire-and-forget unawaited async IIFE that records `context_management.applied_edits` cleared-token receipts into an upstream compression analytics database table for Claude requests when server-side context clearing is enabled.

### Local architecture and fixture evidence

- DurinDoor does not incorporate upstream's server-side context editing telemetry or compression analytics database.
- DurinDoor provides local prompt compression through RTK (headroom, ponytail, caveman) in [`open-sse/rtk/`](../../../open-sse/rtk/) and [`open-sse/handlers/chatCore/compressionHook.js`](../../../open-sse/handlers/chatCore/compressionHook.js). Token savings are recorded via `recordTokenSaverEvent` in [`src/lib/db/repos/usageRepo.js`](../../../src/lib/db/repos/usageRepo.js).
- In [`open-sse/handlers/chatCore/nonStreamingHandler.js`](../../../open-sse/handlers/chatCore/nonStreamingHandler.js), completed responses record usage and request details via `saveUsageStats` and `saveRequestDetail`.
- Offline fixtures in [`tests/unit/cached-token-usage.test.js`](../../../tests/unit/cached-token-usage.test.js) and [`tests/unit/request-detail-usage.test.js`](../../../tests/unit/request-detail-usage.test.js) exercise non-streaming token usage preservation and attribution.
- The upstream change is a pure refactor that changes zero runtime bytes.

**Disposition: upstream leaf refactor of source-specific telemetry; do not port.**

---

## 2. OmniRoute #4780 — `scheduleQuotaShareConsumption` extraction

### Exact pins

- PR: [OmniRoute #4780](https://github.com/cheaper-inference/OmniRoute/pull/4780)
- Exact head: [`d66a2545fc079396c96be86bd755c8b63689a304`](https://github.com/cheaper-inference/OmniRoute/commit/d66a2545fc079396c96be86bd755c8b63689a304)
- Enclosing merge: [`326c61e4c7256872e343e6fce4dc861d590122e2`](https://github.com/cheaper-inference/OmniRoute/commit/326c61e4c7256872e343e6fce4dc861d590122e2)

### Upstream contract

The patch extracts the non-streaming shared-quota POST-hook (B/F7) from `handleChatCore` into `open-sse/handlers/chatCore/quotaShareConsumption.ts`:

```ts
export async function scheduleQuotaShareConsumption(args: {
  apiKeyId: string | null | undefined;
  connectionId: string | null | undefined;
  provider: string | null | undefined;
  usage: unknown;
  estimatedCost: number;
  log?: LoggerLike;
}): Promise<void> {
  if (!args.apiKeyId || !args.connectionId) return;
  try {
    const { scheduleRecordConsumption, buildConsumptionCost } = await import(
      "@/lib/quota/spendRecorder"
    );
    scheduleRecordConsumption(
      {
        apiKeyId: args.apiKeyId,
        connectionId: args.connectionId,
        provider: args.provider ?? "unknown",
        cost: buildConsumptionCost(args.usage, args.estimatedCost),
      },
      args.log
    );
  } catch (_) {
    // Outer fail-open — never throws to caller
  }
}
```

The hook checks for an API key ID and connection ID, dynamically imports `@/lib/quota/spendRecorder`, and delegates consumption recording to `setImmediate` in a fail-open boundary.

### Local architecture and fixture evidence

- DurinDoor does not use `@/lib/quota/spendRecorder` for quota settlement.
- DurinDoor manages quota capacity and concurrency via reservation tickets in [`src/shared/services/quotaSelection.js`](../../../src/shared/services/quotaSelection.js) and [`src/lib/db/repos/quotaReservationsRepo.js`](../../../src/lib/db/repos/quotaReservationsRepo.js).
- When a dispatch begins, an atomic reservation is acquired (`acquireQuotaReservation`) and marked active (`markQuotaReservationDispatched`).
- In [`open-sse/handlers/chatCore/nonStreamingHandler.js`](../../../open-sse/handlers/chatCore/nonStreamingHandler.js), when a non-streaming response succeeds:
  1. Token counters are extracted via `extractUsageFromResponse`.
  2. Total usage, latency, and costs are persisted to the database via `saveUsageStats` and `saveRequestDetail`.
  3. The reservation ticket is committed cleanly via `ticket.settle({ success: true })` (`commitQuotaReservation`). If the request fails or aborts, the ticket is released with a classified terminal reason (`releaseQuotaReservation`).
- Offline test coverage in [`tests/unit/quota-reservation-lifecycle.test.js`](../../../tests/unit/quota-reservation-lifecycle.test.js) and [`tests/unit/quota-reservations.test.js`](../../../tests/unit/quota-reservations.test.js) exercises the full acquire -> dispatch -> heartbeat -> commit/release lifecycle.
- The upstream change is a pure refactor of an inline hook into an external function with zero behavior difference.

**Disposition: upstream leaf refactor of source-specific quota-share post-hook; do not port.**

---

## 3. OmniRoute #4784 — `scheduleStreamingQuotaShareConsumption` extraction

### Exact pins

- PR: [OmniRoute #4784](https://github.com/cheaper-inference/OmniRoute/pull/4784)
- Exact head: [`82dc7d14e0c4905da06c3cbaacbac055ff8c7469`](https://github.com/cheaper-inference/OmniRoute/commit/82dc7d14e0c4905da06c3cbaacbac055ff8c7469)
- Enclosing merge: [`2e0654950dcafb0f556217324bc9d2c081a83444`](https://github.com/cheaper-inference/OmniRoute/commit/2e0654950dcafb0f556217324bc9d2c081a83444)

### Upstream contract

The patch extracts the streaming shared-quota POST-hook (B/F7) from `onStreamComplete` in `handleChatCore` into `open-sse/handlers/chatCore/streamingQuotaShare.ts`:

```ts
export function scheduleStreamingQuotaShareConsumption(args: {
  apiKeyId: string | null | undefined;
  connectionId: string | null | undefined;
  provider: string | null | undefined;
  model: string | null | undefined;
  streamUsage: unknown;
  streamStatus: number;
  serviceTier?: string;
  calculateCost: CostResolver;
  log?: LoggerLike;
}): void {
  if (!args.apiKeyId || !args.connectionId || args.streamStatus !== 200) return;

  const quotaApiKeyId = args.apiKeyId;
  const quotaConnectionId = args.connectionId;
  import("@/lib/quota/spendRecorder")
    .then(({ recordStreamingConsumption }) =>
      recordStreamingConsumption(
        {
          apiKeyId: quotaApiKeyId,
          connectionId: quotaConnectionId,
          provider: args.provider,
          model: args.model,
          streamUsage: args.streamUsage,
          streamStatus: args.streamStatus,
          serviceTier: args.serviceTier,
        },
        { calculateCost: args.calculateCost, log: args.log }
      )
    )
    .catch(() => {
      // Outer fail-open — never throws to caller
    });
}
```

Because `onStreamComplete` is synchronous, the helper executes via `.then().catch()` fire-and-forget, guarding on `apiKeyId`, `connectionId`, and `streamStatus === 200`, and passes an injected `calculateCost` function.

### Local architecture and fixture evidence

- Streaming settlement in DurinDoor is coordinated through `buildOnStreamComplete` in [`open-sse/handlers/chatCore/streamingHandler.js`](../../../open-sse/handlers/chatCore/streamingHandler.js).
- When a stream completes normally, encounters an error, or is cancelled by the client:
  1. `onStreamComplete` receives accumulated tokens or extracts usage from the terminal frame.
  2. It invokes `saveUsageStats` with token counters, stream status (`null`, `"error"`, or `"cancelled"`), TTFT, and total latency.
  3. `saveRequestDetail` captures the full request and token summary.
  4. The associated quota reservation ticket is settled (`commitQuotaReservation` on success, or `releaseQuotaReservation` on error/cancel).
- Offline tests in [`tests/unit/stream-completion-usage.test.js`](../../../tests/unit/stream-completion-usage.test.js), [`tests/unit/passthrough-usage-trailer.test.js`](../../../tests/unit/passthrough-usage-trailer.test.js), and [`tests/unit/chat-usage-total-reconcile.test.js`](../../../tests/unit/chat-usage-total-reconcile.test.js) exercise stream completion usage processing, cancelled stream attribution, and terminal metadata reconciliation.
- Upstream #4784 is a pure refactor of an upstream-specific spend recorder hook and introduces no new observable behavior.

**Disposition: upstream leaf refactor of source-specific streaming quota-share post-hook; do not port.**

---

## 4. OmniRoute #4790 — `recordStreamingCost` extraction

### Exact pins

- PR: [OmniRoute #4790](https://github.com/cheaper-inference/OmniRoute/pull/4790)
- Exact head: [`5bbce0a2ff18abf3cacef9376a4589682d98d52a`](https://github.com/cheaper-inference/OmniRoute/commit/5bbce0a2ff18abf3cacef9376a4589682d98d52a)
- Enclosing merge: [`1304333a5dc54408a13ae818e6d5889f72cd15d4`](https://github.com/cheaper-inference/OmniRoute/commit/1304333a5dc54408a13ae818e6d5889f72cd15d4)

### Upstream contract

The patch extracts the per-request streaming cost resolution and recording hook from `onStreamComplete` in `handleChatCore` into `open-sse/handlers/chatCore/streamingCost.ts`:

```ts
export function recordStreamingCost(args: {
  apiKeyId: string | null | undefined;
  provider: string | null | undefined;
  model: string | null | undefined;
  streamUsage: Record<string, number | undefined> | null | undefined;
  serviceTier?: string;
  calculateCost: CostResolver;
  recordCost: (apiKeyId: string, cost: number) => void;
}): void {
  if (!args.apiKeyId || !args.streamUsage) return;

  const apiKeyId = args.apiKeyId;
  args
    .calculateCost(args.provider, args.model, args.streamUsage, { serviceTier: args.serviceTier })
    .then((estimatedCost) => {
      if (estimatedCost > 0) args.recordCost(apiKeyId, estimatedCost);
    })
    .catch(() => {});
}
```

The extracted helper guards against missing `apiKeyId` or `streamUsage`, invokes the injected `calculateCost` promise, and on resolution calls `recordCost(apiKeyId, estimatedCost)` if `estimatedCost > 0`.

### Local architecture and fixture evidence

- DurinDoor does not maintain a detached `recordCost` sidecar for API keys.
- Cost computation in DurinDoor is integrated directly into unified usage settlement in [`src/lib/db/repos/usageRepo.js`](../../../src/lib/db/repos/usageRepo.js):
  - When `saveUsageStats` is called (from both `nonStreamingHandler.js` and `streamingHandler.js`), it resolves pricing models via [`open-sse/providers/pricing.js`](../../../open-sse/providers/pricing.js) (`calculateCostFromTokens` and `calculateCostBreakdown`).
  - Tokens and pricing breakdowns (prompt, completion, cached, reasoning) are atomically written into `usage_history` and associated with the `apiKeyId`.
- This ensures tokens and dollar costs remain strictly consistent in a single record rather than being updated asynchronously through an uncoordinated external callback.
- Checked-in offline tests in [`tests/unit/usage-cost-split-db.test.js`](../../../tests/unit/usage-cost-split-db.test.js), [`tests/unit/usage-cost-breakdown.test.js`](../../../tests/unit/usage-cost-breakdown.test.js), and [`tests/unit/api-key-stable-usage-accounting.test.js`](../../../tests/unit/api-key-stable-usage-accounting.test.js) verify exact cost calculation, token split accounting, and API key billing aggregation.
- The upstream change is a pure refactor that extracts an existing inline hook and injects its dependencies.

**Disposition: upstream leaf refactor of decoupled streaming cost hook; do not port.**

---

## Ordinary offline acceptance

No porting or product changes are required. Each examined upstream pull request is a pure structural extraction (leaf decomposition) of an existing post-hook from OmniRoute's `chatCore.ts` god-file decomposition series (`#3501`), with identical runtime semantics and no changes to wire protocols, token extraction, or rate limiting.

DurinDoor's local architecture maintains complete and cohesive coverage across all affected seams:
1. **Quota reservation & settlement:** Atomic acquire, dispatch, heartbeat, and commit/release lifecycle verified by [`tests/unit/quota-reservation-lifecycle.test.js`](../../../tests/unit/quota-reservation-lifecycle.test.js) and [`tests/unit/quota-reservations.test.js`](../../../tests/unit/quota-reservations.test.js).
2. **Streaming usage settlement:** Stream completion token extraction, cancelled stream attribution, and terminal metadata reconciliation verified by [`tests/unit/stream-completion-usage.test.js`](../../../tests/unit/stream-completion-usage.test.js), [`tests/unit/passthrough-usage-trailer.test.js`](../../../tests/unit/passthrough-usage-trailer.test.js), and [`tests/unit/chat-usage-total-reconcile.test.js`](../../../tests/unit/chat-usage-total-reconcile.test.js).
3. **Usage cost breakdown and persistence:** Multi-tier token pricing, cached/reasoning cost separation, and SQLite usage history reconciliation verified by [`tests/unit/usage-cost-split-db.test.js`](../../../tests/unit/usage-cost-split-db.test.js), [`tests/unit/usage-cost-breakdown.test.js`](../../../tests/unit/usage-cost-breakdown.test.js), and [`tests/unit/api-key-stable-usage-accounting.test.js`](../../../tests/unit/api-key-stable-usage-accounting.test.js).

Because there is no demonstrated narrow gap in DurinDoor's quota, cost, or usage settlement pipelines, no behavioral modifications or new fixture implementations are warranted. This evaluation was conducted via static source and offline test inspection without issuing live network requests, reading production credentials, or modifying accounting state.
