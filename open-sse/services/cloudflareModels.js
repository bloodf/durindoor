import { sanitizeErrorMessage } from "../utils/error.js";
import { isString } from "../../src/shared/utils/typeChecks.js";

const SEARCH_PAGE_SIZE = 100;
const MAX_SEARCH_PAGES = 20;
const SEARCH_TIMEOUT_MS = 10_000;

// The search task name decides when present; the id decides for rows without one.
const CHAT_TASK = /text generation/i;
const IMAGE_TASK = /text.to.image|image generation/i;
const UNSUPPORTED_ID = /bge-|embedding|aura-|melotts|whisper|nova-|deepgram\/flux|pipecat|smart-turn|resnet|distilbert|m2m100|indictrans|llama-guard|reranker|image-classif|speech|asr/i;
const IMAGE_ID = /flux|stable-diffusion|dreamshaper|sdxl|phoenix|lucid|sd-v|imagen/i;
const UNLISTED_STATIC_KINDS = new Set(["embedding", "tts", "stt"]);

/**
 * The id Workers AI routes on. A search row's `id` is an internal UUID and the
 * `@cf/` or `@hf/` id is in `name`; other response shapes carry it in `id`.
 */
export function cloudflareInferenceId(entry) {
  return [entry?.name, entry?.id].find((value) => isString(value) && /^@(cf|hf)\//.test(value)) || "";
}

function modelKind(entry, id, staticKind) {
  if (UNLISTED_STATIC_KINDS.has(staticKind)) return null;
  const task = entry?.task?.name || "";
  if (task) {
    if (IMAGE_TASK.test(task)) return "image";
    return CHAT_TASK.test(task) ? "llm" : null;
  }
  if (UNSUPPORTED_ID.test(id)) return null;
  return staticKind === "image" || IMAGE_ID.test(id) ? "image" : "llm";
}

function displayName(entry, id) {
  if (isString(entry.name) && entry.name && entry.name !== id) return entry.name;
  return id.split("/").pop().replace(/[-_]/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function toModels(entries, staticModels) {
  const staticKinds = new Map(staticModels.map((model) => [model.id, model.kind || model.type || "llm"]));
  const models = new Map();
  for (const entry of entries) {
    const id = cloudflareInferenceId(entry);
    const kind = id ? modelKind(entry, id, staticKinds.get(id)) : null;
    if (!kind) continue;
    const description = isString(entry.description) ? entry.description : "";
    models.set(id, { id, name: displayName(entry, id), kind, description });
  }
  return [...models.values()];
}

async function searchCatalog(accountId, token, fetchImpl) {
  const base = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/models/search`;
  const entries = [];
  let pages = 1;
  for (let page = 1; page <= pages; page++) {
    const response = await fetchImpl(`${base}?page=${page}&per_page=${SEARCH_PAGE_SIZE}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (data?.success === false || data?.errors?.length) throw new Error("Cloudflare returned an API error");
    if (!Array.isArray(data?.result)) throw new Error("Cloudflare returned no model list");
    entries.push(...data.result);
    const info = data.result_info;
    pages = Number(info?.total_pages) ||
      Math.ceil(Number(info?.total_count || 0) / Number(info?.per_page || SEARCH_PAGE_SIZE)) || 1;
    if (pages > MAX_SEARCH_PAGES) throw new Error(`Cloudflare catalog exceeds ${MAX_SEARCH_PAGES} pages`);
  }
  return entries;
}

/**
 * List the chat and image models of a Workers AI account. Any upstream problem
 * answers with the static catalog and a warning.
 */
export async function discoverCloudflareModels(connection, { fetchImpl, staticModels }) {
  const accountId = connection.providerSpecificData?.accountId;
  if (!isString(accountId) || !accountId.trim()) return { error: "Missing Cloudflare Account ID", status: 400 };
  const token = connection.apiKey || connection.accessToken;
  if (!token) return { error: "No valid token found", status: 401 };
  try {
    const models = toModels(await searchCatalog(accountId.trim(), token, fetchImpl), staticModels);
    if (!models.length) throw new Error("Cloudflare returned no supported chat or image models");
    return { models };
  } catch (error) {
    return {
      models: staticModels,
      warning: `Failed to fetch Cloudflare models (${sanitizeErrorMessage(error?.message || "unknown error")}); using the static catalog.`,
      source: "local_catalog",
      degraded: true,
    };
  }
}
