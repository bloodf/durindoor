import { getEngine, isEngineAvailable, ENGINE_IDS } from "open-sse/services/compression/index.js";

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
// (dashboard JWT). The Compression Studio page at
// `src/app/(dashboard)/dashboard/compression-studio/page.js` POSTs here WITHOUT
// an LLM API key, so re-checking `settings.requireApiKey` in this handler would
// 401 every dashboard request whenever the global LLM-endpoint enforcement flag
// is on. Trust the proxy; do not re-authenticate.
function computeSavingsPercent(stats) {
  if (!stats || typeof stats !== "object") return 0;
  if (typeof stats.savingsPercent === "number") return stats.savingsPercent;
  const before = stats.bytesBefore ?? stats.tokensBefore ?? stats.originalTokens;
  const after = stats.bytesAfter ?? stats.tokensAfter ?? stats.compressedTokens;
  if (typeof before !== "number" || typeof after !== "number" || before <= 0) return 0;
  const pct = ((before - after) / before) * 100;
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

  const results = {};
  for (const id of ENGINE_IDS) {
    if (!isEngineAvailable(id)) {
      results[id] = { status: "unavailable" };
      continue;
    }
    try {
      const result = await getEngine(id).apply(body, {});
      results[id] = {
        status: result?.compressed === true ? "compressed" : "unchanged",
        compressed: result?.compressed === true,
        savingsPercent: computeSavingsPercent(result?.stats),
      };
    } catch {
      results[id] = { status: "error" };
    }
  }

  return Response.json({ engines: ENGINE_IDS, results });
}
