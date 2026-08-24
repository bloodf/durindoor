import {
  getEngine,
  isEngineAvailable,
  ENGINE_IDS } from
"open-sse/services/compression/index.js";
import { ENGINE_CATALOG } from "open-sse/services/compression/engineCatalog.js";

// POST /api/compression/preview — run each catalog engine against the body and
// report a per-id status:
//   - { status: "unavailable" }              catalog placeholder not shipped here
//   - { status: "compressed", compressed, savingsPercent }   available, ran
//   - { status: "error" }                    available but apply() threw
// Unavailable engines are NEVER dispatched to getEngine() (which throws on
// placeholders); available engines that throw are labeled "error", never
// "unavailable".
//
// Auth: this handler is internal to the dashboard. `src/dashboardGuard.js:262-289`
// deny-by-defaults every `/api/*` path that is not on the public allow-list and
// requires either a valid CLI token or an authenticated dashboard session
// (dashboard JWT). The Test Savers page at
// `src/app/(dashboard)/dashboard/compression-studio/page.js` POSTs here WITHOUT
// an LLM API key, so re-checking `settings.requireApiKey` in this handler would
// 401 every dashboard request whenever the global LLM-endpoint enforcement flag
// is on. Trust the proxy; do not re-authenticate.
// OmniRoute #6461 (PR #6519): when an engine fell back (`stats.fallbackApplied`),
// surface WHY by synthesizing a deduped reason list from data the pipeline
// already produces on `stats`: `validationErrors` plus inflation-guard entries
// in `validationWarnings`. Non-fallback runs get [] / null — zero change on the
// happy path, even when warnings exist (mirrors the source gating).
import { isNumber, isObject, isString } from "@/shared/utils/typeChecks.js";function computeFallbackReasons(stats) {
  const reasons = [];
  if (!stats || stats.fallbackApplied !== true) return reasons;
  const seen = new Set();
  const push = (s) => {
    if (isString(s) && s.length > 0 && !seen.has(s)) {
      seen.add(s);
      reasons.push(s);
    }
  };
  for (const err of stats.validationErrors ?? []) push(err);
  for (const warn of stats.validationWarnings ?? []) {
    if (isString(warn) && warn.startsWith("pipeline-inflation-guard:")) push(warn);
  }
  return reasons;
}

function computeSavingsPercent(stats) {
  if (!stats || !isObject(stats)) return 0;
  if (isNumber(stats.savingsPercent)) return stats.savingsPercent;
  const before = stats.bytesBefore ?? stats.tokensBefore ?? stats.originalTokens;
  const after = stats.bytesAfter ?? stats.tokensAfter ?? stats.compressedTokens;
  if (!isNumber(before) || !isNumber(after) || before <= 0) return 0;
  const pct = (before - after) / before * 100;
  return Number.isFinite(pct) ? Math.round(pct * 100) / 100 : 0;
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: { message: "Invalid JSON body", type: "invalid_request_error" } },
      { status: 400 }
    );
  }

  if (!body || !isObject(body) || Array.isArray(body)) {
    return Response.json(
      { error: { message: "Invalid JSON body", type: "invalid_request_error" } },
      { status: 400 }
    );
  }

  // Accept an optional `engine` selector outside the compression payload. If
  // provided, only that engine runs; otherwise the entire catalog is previewed.
  // Unknown or unavailable ids are rejected before the payload is touched.
  const { engine, ...payload } = body;

  let engineIds = ENGINE_IDS;
  if (engine !== undefined && engine !== "") {
    const meta = ENGINE_CATALOG[engine];
    if (!meta || !isEngineAvailable(engine)) {
      return Response.json(
        { error: { message: `Unknown or unavailable engine: ${engine}`, type: "invalid_request_error" } },
        { status: 400 }
      );
    }
    engineIds = [engine];
  }

  const results = {};
  for (const id of engineIds) {
    if (!isEngineAvailable(id)) {
      results[id] = { status: "unavailable" };
      continue;
    }
    try {
      const result = await getEngine(id).apply(payload, {});
      const fallbackReasons = computeFallbackReasons(result?.stats);
      const raw = result?.body;
      results[id] = {
        status: result?.compressed === true ? "compressed" : "unchanged",
        compressed: result?.compressed === true,
        savingsPercent: computeSavingsPercent(result?.stats),
        // Source emits one pipeline-wide list under `skippedReasons` /
        // `fallbackReasons` / `fallbackReason`; durindoor previews per engine,
        // so the same fields land on each engine's result. The canonical
        // `stats.fallbackReason` is honored only on fallback runs (a fallback
        // may carry it with no synthesizable errors/warnings); non-fallback
        // runs are strictly [] / [] / null per the source contract.
        fallbackReasons,
        skippedReasons: fallbackReasons,
        fallbackReason:
        result?.stats?.fallbackApplied === true ?
        result.stats.fallbackReason ?? fallbackReasons[0] ?? null :
        null,
        ...(raw !== undefined ? { raw } : null)
      };
    } catch {
      results[id] = { status: "error" };
    }
  }

  return Response.json({ engines: engineIds, results });
}