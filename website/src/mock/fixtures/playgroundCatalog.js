// OpenAI-style model catalog for /v1/models and /api/v1/models/*, built from
// the shared world connections, combos and aliases plus the static provider
// catalogs the real gateway ships (see src/app/api/v1/models/buildModelsList.js).

import { getModelKind, getModelsByProviderId } from "@/shared/constants/models";
import { COMBOS, CONNECTIONS, MODEL_ALIASES } from "./world.js";

// URL slug -> service kinds (mirrors src/app/api/v1/models/[...model]/route.js).
export const KIND_SLUG_MAP = Object.freeze({
  image: ["image"],
  tts: ["tts"],
  stt: ["stt"],
  embedding: ["embedding"],
  "image-to-text": ["imageToText"],
  web: ["webSearch", "webFetch"],
  rerank: ["rerank"],
});

// Local models the static catalogs do not know about (Ollama, the vLLM node).
const LOCAL_EXTRAS = Object.freeze({
  "ollama-local": [
    { id: "nomic-embed-text", name: "Nomic Embed Text", kind: "embedding" },
    { id: "qwen3-embedding:8b", name: "Qwen3 Embedding 8B", kind: "embedding" },
  ],
});

const CREATED = Math.floor(Date.UTC(2026, 6, 1) / 1000);

function connectionModels(connection) {
  const catalog = getModelsByProviderId(connection.provider) || [];
  const world = (connection.models || []).map((id) => catalog.find((model) => model.id === id) || { id, name: id });
  const extras = LOCAL_EXTRAS[connection.provider] || [];
  const seen = new Set();
  return [...world, ...catalog, ...extras].filter((model) => {
    if (!model?.id || seen.has(model.id)) return false;
    seen.add(model.id);
    return true;
  });
}

function entryFor(connection, model) {
  const kind = getModelKind(model, "llm");
  return {
    id: `${connection.alias}/${model.id}`,
    object: "model",
    created: CREATED,
    owned_by: connection.alias,
    name: model.name || model.id,
    ...(kind !== "llm" ? { kind } : null),
    ...(model.capabilities ? { capabilities: model.capabilities } : null),
  };
}

/** Build the catalog for the given kinds (default: chat models). */
export function buildModelCatalog(kinds = ["llm"]) {
  const seen = new Set();
  const providers = CONNECTIONS.filter((connection) => connection.isActive !== false).flatMap((connection) =>
    connectionModels(connection)
      .filter((model) => kinds.includes(getModelKind(model, "llm")))
      .map((model) => entryFor(connection, model)),
  );
  const combos = COMBOS.filter((combo) => kinds.includes(combo.kind || "llm")).map((combo) => ({
    id: combo.name,
    object: "model",
    created: CREATED,
    owned_by: "combo",
  }));
  const aliases = kinds.includes("llm")
    ? Object.entries(MODEL_ALIASES).map(([alias, target]) => ({ id: alias, object: "model", created: CREATED, owned_by: "alias", root: target }))
    : [];
  return [...combos, ...aliases, ...providers].filter((entry) => {
    if (seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
}

/** Resolve `alias/model`, a combo name or an alias to the owning connection. */
export function resolveModel(requested) {
  const raw = String(requested || "").trim();
  const target = MODEL_ALIASES[raw] || COMBOS.find((combo) => combo.name === raw)?.models?.[0] || raw;
  const slash = target.indexOf("/");
  const alias = slash > 0 ? target.slice(0, slash) : "";
  const model = slash > 0 ? target.slice(slash + 1) : target;
  const connection =
    CONNECTIONS.find((item) => item.alias === alias && item.isActive !== false) ||
    CONNECTIONS.find((item) => item.provider === alias) ||
    CONNECTIONS.find((item) => (item.models || []).includes(model)) ||
    CONNECTIONS[0];
  return { provider: connection.provider, alias: connection.alias, model, connection };
}
