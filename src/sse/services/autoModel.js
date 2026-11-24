import { isString } from "@/shared/utils/typeChecks.js";
import { buildModelsList } from "@/app/api/v1/models/buildModelsList.js";
import { getProviderConnections } from "@/lib/localDb";
import { resolveProviderId } from "@/shared/constants/providers.js";
import { getProviderValidationGuard } from "open-sse/utils/outboundUrlGuard.js";
import { filterModelsForRequest, getRequestModelDiscoveryOptions } from "./modelAccess.js";
import { listMediaRouteCandidates, mediaEndpointSupport, providerOfModelId } from "./mediaRoutes.js";

export const CAPABILITY_ENDPOINTS = {
  llm: "/v1/chat/completions", image: "/v1/images/generations", video: "/v1/video/generations",
  tts: "/v1/audio/speech", stt: "/v1/audio/transcriptions", embedding: "/v1/embeddings",
  imageToText: "/v1/chat/completions", webSearch: "/v1/search", webFetch: "/v1/web/fetch"
};
const aliases = { chat: "llm", text: "llm", llm: "llm", image: "image", img: "image", video: "video", tts: "tts", stt: "stt", embedding: "embedding", embeddings: "embedding", "image-to-text": "imageToText", imageToText: "imageToText", web: "webSearch", search: "webSearch", fetch: "webFetch" };

/** Parse only the reserved selector syntax; auto/family remains a separate combo. */
export function parseAutoModel(value, defaultKind = "llm") {
  if (!isString(value)) return null;
  const match = /^(auto|best|fast|cheap)(?::([\w-]+))?$/.exec(value.trim());
  if (!match || (match[2] && !aliases[match[2]])) return null;
  return { strategy: match[1], kind: aliases[match[2] || defaultKind], name: match[0] };
}

/** Rank concrete entries without changing the model catalog or pricing policy. */
export function rankAutoModels(models, strategy) {
  const preference = { best: /pro|ultra|max|sonnet|opus/i, fast: /flash|turbo|fast|lite|schnell/i, cheap: /free|lite|mini|flash|schnell/i }[strategy];
  return models.filter((m) => m.availability?.status !== "unavailable").slice().sort((a, b) => {
    const status = (m) => m.availability?.status === "available" ? 0 : 1;
    return status(a) - status(b) || (Number(a.priority ?? 999) - Number(b.priority ?? 999)) ||
      (preference ? Number(preference.test(b.id)) - Number(preference.test(a.id)) : 0) || a.id.localeCompare(b.id);
  });
}

/** Annotate discovery rows using all active connections, so one healthy account wins. */
export function annotateAvailability(models, connections) {
  return models.filter((m) => m?.id && (m.owned_by === "combo" || m.id.includes("/"))).map((m) => {
    if (m.owned_by === "combo") return { ...m, provider: "combo", endpoint: CAPABILITY_ENDPOINTS[m.kind] || null, availability: { status: "configured" } };
    const provider = resolveProviderId(m.id.split("/")[0]);
    const seats = connections.filter((c) => c.isActive !== false && resolveProviderId(c.provider) === provider);
    const usable = seats.filter((c) => !["unavailable", "reauth_required"].includes(c.testStatus));
    const status = usable.some((c) => c.testStatus === "active") ? "available" : usable.length ? "untested" : seats.length ? "unavailable" : "configured";
    const priority = Math.min(...usable.map((c) => Number.isFinite(Number(c.priority)) ? Number(c.priority) : 999), 999);
    const endpoint = m.kind === "video" && !mediaEndpointSupport("video", "/v1/video/generations", provider, m.id.slice(m.id.indexOf("/") + 1)).supported
      ? "/v1/videos" : CAPABILITY_ENDPOINTS[m.kind] || null;
    return { ...m, provider, endpoint, availability: { status }, priority };
  });
}

export async function getCapabilityCatalog(request, kinds = Object.keys(CAPABILITY_ENDPOINTS)) {
  const options = await getRequestModelDiscoveryOptions(request);
  const [connections, ...lists] = await Promise.all([
    getProviderConnections(),
    ...kinds.map((kind) => buildModelsList([kind], getProviderValidationGuard(), options))
  ]);
  const entries = lists.flatMap((list, i) => list.map((m) => ({ ...m, kind: m.kind || kinds[i] })));
  const visibleConnections = options.allowedConnectionIds?.length
    ? connections.filter((c) => options.allowedConnectionIds.includes(c.id)) : connections;
  return annotateAvailability(await filterModelsForRequest(request, entries), visibleConnections);
}

export async function getAutoModelCandidates(value, kind, request, apiKeyId) {
  const parsed = parseAutoModel(value, kind);
  if (!parsed || parsed.kind !== kind) return null;
  let catalog;
  if (kind === "image" || kind === "video") {
    const [models, visible] = await Promise.all([
      listMediaRouteCandidates(kind, { apiKeyId }), getCapabilityCatalog(request, [kind])
    ]);
    const endpoint = CAPABILITY_ENDPOINTS[kind];
    const supported = new Set(models.filter((m) => mediaEndpointSupport(kind, endpoint, providerOfModelId(m.id), m.id.slice(m.id.indexOf("/") + 1)).supported).map((m) => m.id));
    catalog = visible.filter((m) => supported.has(m.id));
  } else {
    catalog = await getCapabilityCatalog(request, [kind]);
  }
  const ranked = rankAutoModels(catalog.filter((m) => m.kind === kind && m.owned_by !== "combo"), parsed.strategy);
  return { ...parsed, models: ranked.map((m) => m.id), catalog: ranked };
}
