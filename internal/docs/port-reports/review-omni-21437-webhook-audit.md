# OmniRoute #21437: webhook configuration audit

**Verdict: concrete missing behavior (medium).** OmniRoute's currently open PR adds success audit events for webhook create, update and delete. DurinDoor's analogous operator destination mutations are not audited. This is a parity gap in administrative traceability; the exact webhook schemas differ, so this finding does not assert parity for OmniRoute's Telegram or generic webhook kinds.

## Upstream snapshot

Read-only `gh api` at review time (2026-11-27): PR #21437 is **open**. Exact base: `release/v3.8.55` at `b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523`. Exact head: `fix/kea-9786-webhook-audit` at `20e39cdafd15f58e2186208fb9b2cf01189219a1`.

Changed files:

- `src/app/api/webhooks/route.ts` (POST create)
- `src/app/api/webhooks/[id]/route.ts` (PUT update, DELETE)
- `src/lib/compliance/index.ts` (best-effort audit write callback)
- `src/lib/webhooks/audit.ts` (actor/context, secret-safe target and details)
- `tests/unit/webhook-audit.test.ts`
- `changelog.d/fixes/kea-9786-webhook-audit.md`

The upstream test exercises successful create/update/delete context, URL and Telegram target masking, omitted secret/field values, validation/not-found/failing delete behavior, and best-effort audit-write failure.

## DurinDoor evidence

Compared Git objects, not the integration checkout: `origin/main` is `29490b783e83176d4d6a4162f76ee3dc79db66ea`; frozen train `orq/tp3r51/integration` is `d27f288cb59be43a4c1068ac314076cde0297413` (a merge of that main commit). The relevant route blobs are unchanged between these heads.

- In `src/app/api/settings/webhooks/route.js`, POST calls `createWebhook(body)` at line 28 and returns at line 30; there is no audit call.
- In `src/app/api/settings/webhooks/[id]/route.js`, PATCH calls `updateWebhook` at line 17 and returns at line 19; DELETE calls `deleteWebhook` at line 29 and returns at line 30. Neither path audits the successful mutation.
- `tests/unit/operator-webhooks-routes.test.js` lines 46–59 covers create/list/delete and validation, but asserts no audit behavior. It contains no PATCH coverage.

The local surface is operator-configured event destinations persisted in `settings.operatorWebhooks`, authenticated by `canModifySecurityCriticalSettings`, with POST/PATCH/DELETE. Thus successful mutation traceability transfers as a behavior; upstream-specific Telegram masking, database row handling, and URL/kind fields do not. Existing security tests establish authorization, not an audit record.

A focused reproduction by source trace: invoke authenticated POST with a valid URL/events body, PATCH an existing webhook, or DELETE an existing webhook; each route's success branch mutates via the functions above and returns without calling an audit writer. Existing route coverage can be inspected with `git show origin/main:tests/unit/operator-webhooks-routes.test.js`; no product execution was needed.

No matching #21437 disposition or webhook-audit claim was found in existing port reports. This does not take ownership from the stated sync lane issues (#21435, #21432, #21426, #21412, #21425, #21427, #21349, #21433, #5884, #5904).
