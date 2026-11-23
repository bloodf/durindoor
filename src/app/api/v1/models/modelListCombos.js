import { PROVIDER_ID_TO_ALIAS } from "@/shared/constants/models";
import { getCombos, getCustomModels } from "@/lib/localDb";
import { aggregateComboCapabilities, overlayComboCapabilities } from "open-sse/providers/capabilities.js";
import { isPaidModel } from "open-sse/providers/pricing.js";
import { isObject, isString } from "../../../../shared/utils/typeChecks.js";
import { LLM_KIND } from "./modelListKinds.js";

export function comboMatchesKinds(combo, kindFilter) {
  const kind = combo?.kind ?? LLM_KIND;
  return kindFilter.includes(kind);
}

/**
 * Project a combo into the public OpenAI model shape with its resolved kind.
 */
export function comboToEntry(combo) {
  const entry = {
    id: combo.name,
    object: "model",
    owned_by: "combo",
    kind: combo.kind ?? LLM_KIND,
  };
  return entry;
}

/**
 * Resolve a combo's member pool through saved nested combos, applying the
 * existing provider/model paid classifier once at each concrete member.
 * Unknown legacy members stay visible; empty and cyclic resolved pools do not.
 */
export function visibleComboMembers(combo, comboByName, hidePaidModels) {
  const members = Array.isArray(combo?.models) ? combo.models : [];
  if (!hidePaidModels) return members;

  const isVisible = (member, seen) => {
    if (!isString(member)) return true;
    if (member.includes("/")) return !isPaidModel(member);
    if (seen.has(member)) return false;
    const nested = comboByName[member];
    if (!Array.isArray(nested)) return true;
    seen.add(member);
    const visible = nested.some((nestedMember) => isVisible(nestedMember, seen));
    seen.delete(member);
    return visible;
  };

  return members.filter((member) => isVisible(member, new Set([combo.name])));
}

export async function buildComboOnlyModels(kindFilter, hidePaidModels) {
  let combos = [];
  let customModels = [];
  try {
    combos = (await getCombos()).filter((combo) => combo !== null);
  } catch (e) {
    console.log("Could not fetch combos");
  }
  try {
    customModels = await getCustomModels();
  } catch (e) {
    console.log("Could not fetch custom models");
  }

  const comboByName = Object.fromEntries(combos.map((combo) => [combo.name, combo.models || []]));
  const aliasToProviderId = Object.fromEntries(Object.entries(PROVIDER_ID_TO_ALIAS).map(([id, alias]) => [alias, id]));
  const customCapsById = new Map(
    customModels
      .filter((m) => m?.id && m?.providerAlias && (m.kind || m.type || LLM_KIND) === LLM_KIND && isObject(m.capabilities))
      .map((m) => [`${aliasToProviderId[m.providerAlias] ?? m.providerAlias}/${m.id}`, m.capabilities]),
  );
  const capabilityComboByName = Object.fromEntries(
    combos.map((combo) => [combo.name, {
      models: Array.isArray(combo.models) ? combo.models.filter(isString) : [],
      capabilities: isObject(combo.capabilities) ? combo.capabilities : null,
    }]),
  );
  const entries = [];
  const seenNames = new Set();
  for (const combo of combos) {
    if (!comboMatchesKinds(combo, kindFilter) || seenNames.has(combo.name)) continue;
    const visibleMembers = visibleComboMembers(combo, comboByName, hidePaidModels);
    if (hidePaidModels && visibleMembers.length === 0) continue;
    const entry = comboToEntry(combo);
    if (entry.kind !== "webSearch" && entry.kind !== "webFetch") {
      const derived = aggregateComboCapabilities(visibleMembers.filter(isString), capabilityComboByName, aliasToProviderId, 0, customCapsById);
      const effective = overlayComboCapabilities(derived, isObject(combo.capabilities) ? combo.capabilities : null);
      if (effective) {
        entry.capabilities = effective;
        if ((combo.kind ?? LLM_KIND) === LLM_KIND) {
          if (Number.isFinite(effective.contextWindow) && effective.contextWindow > 0) entry.context_length = effective.contextWindow;
          if (Number.isFinite(effective.maxOutput) && effective.maxOutput > 0) entry.max_completion_tokens = effective.maxOutput;
        }
      }
    }
    seenNames.add(combo.name);
    entries.push(entry);
  }
  return entries;
}

/**
 * Build OpenAI-format models filtered by service kind. Built-in catalogs are a
 * fallback only when the DB is unavailable; a healthy DB exposes configured
 * connections, persisted custom rows, aliases, and combos. Custom-compatible
 * connections merge saved models with live discovery; dashboard import remains in
 * `/api/providers/[id]/models` and does not contribute to public catalogs.
 */
