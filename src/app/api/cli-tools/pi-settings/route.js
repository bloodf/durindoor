"use server";

/**
 * Pi (pi-coding-agent) settings route — ported from decolua/9router 6c9fe6f.
 *
 * Writes an OpenAI-compatible `providers.durindoor` entry into
 * `~/.pi/agent/models.json` (falls back to `~/.pi/models.json` when only that
 * file exists). Pi takes a model list, so POST accepts `models` (strings or
 * `{ id, name, contextWindow, maxTokens }`) or a single `model`.
 * A legacy `providers.9router` entry counts as configured and is replaced on apply.
 *
 * A dashboard save may send only ids for previously configured models, so
 * POST merges each selected model with its existing `durindoor` entry by id
 * before writing, keeping hand-tuned limits and metadata (name, modalities,
 * cost, compat options, ...) instead of resetting them to the fixed
 * `DEFAULT_CONTEXT_WINDOW` / `DEFAULT_MAX_TOKENS`. Limits still missing after
 * the merge are resolved through scoped cached model metadata (discovered,
 * shared and operator limits), with capability/combo resolution as fallback.
 * The selected list stays authoritative for order and removal; unrelated
 * provider fields (`api`, `authHeader`, custom `headers`, ...) are preserved.
 * With no `durindoor` entry yet, the legacy `9router` entry is the one merged.
 */

import fs from "fs/promises";
import path from "path";
import os from "os";
import { isString } from "@/shared/utils/typeChecks";
import { createSettingsRoute, isPlainObject, withV1 } from "@/lib/cliTools/settingsRoute";
import { getCombos } from "@/lib/localDb";
import { getModelInfo, loadCustomCapabilities, parseModel } from "@/sse/services/model";
import { getCapabilitiesForModel, aggregateComboCapabilities } from "open-sse/providers/capabilities.js";
import { getThinkingLevels } from "open-sse/providers/thinkingLevels.js";
import { piCapsFromModelCaps, sanitizePiModelCaps } from "@/shared/utils/piModels";

const PROVIDER_ID = "durindoor";
const LEGACY_PROVIDER_ID = "9router";
const DEFAULT_CONTEXT_WINDOW = 128000;
const DEFAULT_MAX_TOKENS = 16384;
// Placeholder the dashboard card sends when no key is selected; it is never a
// real credential, so it must not replace a key already stored in models.json.
const PLACEHOLDER_API_KEYS = new Set(["sk_durindoor", "sk_9router"]);
const isPlaceholderKey = (key) => !isString(key) || !key.trim() || PLACEHOLDER_API_KEYS.has(key.trim());

const getAgentModelsPath = () => path.join(os.homedir(), ".pi", "agent", "models.json");
const getRootModelsPath = () => path.join(os.homedir(), ".pi", "models.json");

const exists = (p) => fs.access(p).then(() => true, () => false);

const resolveModelsJsonPath = async () => {
  if (await exists(getAgentModelsPath())) return getAgentModelsPath();
  if (await exists(getRootModelsPath())) return getRootModelsPath();
  return getAgentModelsPath();
};

const hasDurinDoorConfig = (_raw, config) => {
  const providers = config?.providers;
  if (!isPlainObject(providers)) return false;
  if (providers[PROVIDER_ID]?.baseUrl || providers[LEGACY_PROVIDER_ID]?.baseUrl) return true;
  return Object.values(providers).some((p) => String(p?.baseUrl ?? "").includes("20128"));
};

const hasValidLimit = (value) => Number.isFinite(value) && value > 0;

/** Read snake_case limits as Pi's camelCase fields when those are missing (upstream #4287). */
const withCamelLimits = (entry) => {
  const next = { ...entry };
  if (!hasValidLimit(next.contextWindow) && hasValidLimit(next.context_window)) next.contextWindow = next.context_window;
  if (!hasValidLimit(next.maxTokens) && hasValidLimit(next.max_tokens)) next.maxTokens = next.max_tokens;
  return next;
};

/**
 * Resolve missing context/output limits through scoped cached model metadata,
 * including provider/model aliases, shared metadata and operator overrides.
 * Combo names continue to use aggregation (including nested combos).
 */
const resolveMissingCapabilities = async (id, comboLookupRef) => {
  if (!id.includes("/")) {
    comboLookupRef.current ??= Object.fromEntries((await getCombos()).map((c) => [c.name, c.models]));
    if (comboLookupRef.current[id]) {
      const caps = aggregateComboCapabilities(comboLookupRef.current[id], comboLookupRef.current);
      if (caps) return { caps, thinkingLevels: null };
    }
  }
  const resolved = await getModelInfo(id);
  const model = resolved.model || id;
  const requestPrefix = parseModel(id).providerAlias || null;
  const scoped = await loadCustomCapabilities(resolved.provider, model, requestPrefix);
  const caps = scoped || getCapabilitiesForModel(resolved.provider, model);
  let thinkingLevels = null;
  try {
    thinkingLevels = scoped ? null : getThinkingLevels(resolved.provider, model);
  } catch {
    thinkingLevels = null;
  }
  return { caps, thinkingLevels };
};

/**
 * Merge a dashboard-selected model (an id string, or an object carrying only
 * the fields the dashboard chose to send) with the previously saved entry
 * for that id, so hand-tuned limits and metadata survive an ID-only save.
 * Limits still missing after the merge are resolved from capabilities
 * instead of falling back to the fixed Pi defaults.
 */
const mergeModelEntry = async (entry, previousModels, comboLookupRef) => {
  const supplied = isString(entry) ? { id: entry } : entry;
  const id = supplied?.id || "provider/model-id";
  const isNew = !previousModels.has(id);
  const merged = { ...withCamelLimits(previousModels.get(id)), ...withCamelLimits(supplied), id };
  const needsCaps = isNew || !hasValidLimit(merged.contextWindow) || !hasValidLimit(merged.maxTokens);
  const resolved = needsCaps ? await resolveMissingCapabilities(id, comboLookupRef) : null;
  const caps = resolved?.caps;
  // A newly added model is seeded with its input, reasoning and thinking levels
  // (upstream 9router 1ca076167e); a saved entry keeps what it already states.
  const seeded = isNew ? { ...piCapsFromModelCaps(caps, resolved?.thinkingLevels), ...merged } : merged;
  const next = {
    ...seeded,
    name: merged.name || id,
    contextWindow: hasValidLimit(merged.contextWindow) ? merged.contextWindow : caps?.contextWindow || DEFAULT_CONTEXT_WINDOW,
    maxTokens: hasValidLimit(merged.maxTokens) ? merged.maxTokens : caps?.maxOutput || DEFAULT_MAX_TOKENS,
  };
  // Values Pi's schema rejects are dropped, never written back; a null map would
  // invalidate the whole models.json.
  delete next.input;
  delete next.reasoning;
  delete next.thinkingLevelMap;
  return { ...next, ...sanitizePiModelCaps(seeded) };
};

/** Merge the DurinDoor provider into models.json, carrying over a legacy 9router entry. */
const applyProvider = async (existing, { baseUrl, apiKey, model, models }) => {
  const providers = isPlainObject(existing.providers) ? { ...existing.providers } : {};
  // A 9router install has only the legacy entry; it is replaced, so its
  // hand-tuned models and provider options carry over.
  const previousProvider = providers[PROVIDER_ID] || providers[LEGACY_PROVIDER_ID] || {};
  delete providers[LEGACY_PROVIDER_ID];

  const previousModels = new Map(
    (Array.isArray(previousProvider.models) ? previousProvider.models : []).map((m) => [m.id, m])
  );
  const selected = Array.isArray(models) && models.length > 0 ? models : [model || "provider/model-id"];
  const comboLookupRef = { current: null };
  const modelList = [];
  for (const entry of selected) {
    modelList.push(await mergeModelEntry(entry, previousModels, comboLookupRef));
  }

  providers[PROVIDER_ID] = {
    ...previousProvider,
    baseUrl: withV1(baseUrl),
    apiKey: isPlaceholderKey(apiKey)
      ? (isPlaceholderKey(previousProvider.apiKey) ? "sk_durindoor" : previousProvider.apiKey)
      : apiKey,
    api: previousProvider.api || "openai-completions",
    models: modelList,
  };
  return { ...existing, providers };
};

/** Remove the DurinDoor (and legacy 9router) provider, keep everything else. */
const resetProvider = (existing) => {
  if (!isPlainObject(existing.providers)) return null;
  const providers = { ...existing.providers };
  delete providers[PROVIDER_ID];
  delete providers[LEGACY_PROVIDER_ID];
  const next = { ...existing, providers };
  if (Object.keys(providers).length === 0) delete next.providers;
  return next;
};

const route = createSettingsRoute({
  id: "pi",
  displayName: "Pi",
  format: "json",
  secretFields: ["apiKey"],
  messages: { applied: "Pi settings applied! Use /model in Pi to select a DurinDoor model." },
  resolvePath: resolveModelsJsonPath,
  isConfigured: hasDurinDoorConfig,
  apply: applyProvider,
  reset: resetProvider,
});

export async function GET() {
  return route.GET();
}

export async function POST(request) {
  return route.POST(request);
}

export async function DELETE() {
  return route.DELETE();
}
