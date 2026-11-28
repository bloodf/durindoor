import { buildClineHeaders } from "../../shared/clineAuth.js";
import { isString } from "../../../src/shared/utils/typeChecks.js";
import { createCatalogCache } from "./catalogCache.js";

const CLINEPASS_MODELS_ENDPOINT = "https://api.cline.bot/api/v1/models";
// Public feed, fetched without credentials. Its clinePass[] tier is the live source
// since /api/v1/models stopped listing cline-pass/* ids (decolua/9router#4674).
const CLINE_RECOMMENDED_MODELS_ENDPOINT = "https://api.cline.bot/api/v1/ai/cline/recommended-models";
const FETCH_TIMEOUT_MS = 5000;
// No TTL: every lookup stays live, and only concurrent identical ones share it.
const catalogCache = createCatalogCache({
  keyFn: (token, isApiKey) => JSON.stringify([token, isApiKey])
});

/**
 * Build request headers for the ClinePass /models endpoint (Cline's upstream API).
 * - API keys are sent as plain Bearer tokens.
 * - OAuth access tokens must carry the WorkOS `workos:` prefix (handled by buildClineHeaders).
 */
function buildModelListHeaders(token, isApiKey) {
  if (isApiKey) {
    return {
      Accept: "application/json",
      Authorization: `Bearer ${token}`
    };
  }
  return buildClineHeaders(token, { Accept: "application/json" });
}

/**
 * Fetch the live ClinePass model catalog: the recommended-models feed first,
 * then Cline's /models endpoint when the feed lists no ClinePass model.
 *
 * @param {object} credentials - Connection credentials ({ accessToken, apiKey })
 * @returns {Promise<{ models: { id: string, name: string }[] } | null>}
 */
export async function resolveClinepassModels(credentials) {
  const isApiKey = Boolean(credentials?.apiKey);
  const token = isApiKey ? credentials.apiKey : credentials?.accessToken;
  if (!token) return null;

  return catalogCache.load(
    catalogCache.keyFor(token, isApiKey),
    async () => (await fetchClinepassFeed()) || fetchClinepassCatalog(token, isApiKey)
  );
}

/** Keep the cline-pass/* rows of a raw list, exposed under their short ids. */
function toClinepassCatalog(rawList) {
  if (!Array.isArray(rawList)) return null;

  const models = rawList.
  filter((m) => isString(m?.id) && m.id.startsWith("cline-pass/")).
  map((m) => ({
    id: m.id.slice("cline-pass/".length),
    name: m.name || m.id.slice("cline-pass/".length),
    upstreamModelId: m.id
  }));

  return models.length ? { models } : null;
}

async function fetchClinepassFeed() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(CLINE_RECOMMENDED_MODELS_ENDPOINT, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal
    });

    if (!response.ok) return null;

    return toClinepassCatalog((await response.json())?.clinePass);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchClinepassCatalog(token, isApiKey) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const headers = buildModelListHeaders(token, isApiKey);

    const response = await fetch(CLINEPASS_MODELS_ENDPOINT, {
      method: "GET",
      headers,
      signal: controller.signal
    });

    if (!response.ok) return null;

    const json = await response.json();
    return toClinepassCatalog(Array.isArray(json) ? json : json?.data);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}