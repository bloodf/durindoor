import { extractApiKey, evaluateApiKeyAuth } from "@/sse/services/auth.js";
import { getSettings } from "@/lib/localDb";
import { getEngine, isEngineAvailable, ENGINE_IDS } from "open-sse/services/compression/index.js";

// POST /api/compression/preview — run each catalog engine against the body and
// report a per-id status:
//   - { status: "unavailable" }              catalog placeholder not shipped here
//   - { status: "compressed", compressed, savingsPercent }   available, ran
//   - { status: "error" }                    available but apply() threw
// Unavailable engines are NEVER dispatched to getEngine() (which throws on
// placeholders); available engines that throw are labeled "error", never
// "unavailable". Auth matches the other /api routes (extractApiKey +
// evaluateApiKeyAuth gated by requireApiKey).
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
  const settings = await getSettings();
  const apiKey = extractApiKey(request);
  const auth = await evaluateApiKeyAuth(apiKey, {
    required: settings.requireApiKey === true,
    request,
  });
  if (!auth.ok) {
    const message = auth.reason === "missing" ? "Missing API key" : "Invalid API key";
    return Response.json(
      { error: { message, type: "invalid_request_error", code: "invalid_api_key" } },
      { status: 401 }
    );
  }

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
