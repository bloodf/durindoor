"use client";

import { useState, useEffect } from "react";
import { aggregateComboCapabilities, getCapabilitiesForModel, overlayComboCapabilities } from "open-sse/providers/capabilities.js";
import { PROVIDER_ID_TO_ALIAS } from "@/shared/constants/models";
import { isString } from "@/shared/utils/typeChecks";

// Fetch model capabilities and expose a lookup by fullModel ("provider/model"), bare model id, or combo name.
// `enabled` lets persistent modals reload local capability data each time they open.
export function useModelCaps(enabled = true) {
  const [byFull, setByFull] = useState({});
  const [byId, setById] = useState({});
  const [byCombo, setByCombo] = useState({});

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    (async () => {
      try {
        const [res, customRes, combosRes] = await Promise.all([
          fetch("/api/models"),
          fetch("/api/models/custom"),
          fetch("/api/combos"),
        ]);
        if (!res.ok) return;
        const data = await res.json();
        const customData = customRes?.ok ? await customRes.json() : { models: [] };
        const combosData = combosRes?.ok ? await combosRes.json() : { combos: [] };
        const full = {};
        const id = {};
        for (const m of data.models || []) {
          if (!m.caps) continue;
          if (m.fullModel) full[m.fullModel] = m.caps;
          if (m.model) id[m.model] = m.caps;
        }
        // Custom overrides stay provider-scoped: only the "providerAlias/id"
        // key is written, so two providers sharing a model id never clobber
        // each other. Bare-id lookups intentionally see no custom overrides —
        // a bare id is ambiguous across providers.
        for (const m of customData.models || []) {
          if (!m.id || !m.providerAlias) continue;
          const key = `${m.providerAlias}/${m.id}`;
          full[key] = { ...full[key], ...(m.capabilities || {}) };
        }
        // Combo ceilings are local data: derive them from saved members and
        // custom overrides instead of mounting the live-discovery /v1/models endpoint.
        const aliasToProviderId = Object.fromEntries(
          Object.entries(PROVIDER_ID_TO_ALIAS).flatMap(([providerId, alias]) => [[providerId, providerId], [alias, providerId]]),
        );
        const customCaps = new Map(
          (customData.models || [])
            .filter((m) => m?.id && m?.providerAlias && m?.capabilities)
            .map((m) => [`${aliasToProviderId[m.providerAlias] ?? m.providerAlias}/${m.id}`, m.capabilities]),
        );
        const comboLookup = Object.fromEntries(
          (combosData.combos || []).map((combo) => [combo.name, {
            models: Array.isArray(combo.models) ? combo.models.filter(isString) : [],
            capabilities: combo.capabilities,
          }]),
        );
        const combo = {};
        for (const comboRow of combosData.combos || []) {
          if (!comboRow?.name) continue;
          const derived = aggregateComboCapabilities(comboLookup[comboRow.name].models, comboLookup, aliasToProviderId, 0, customCaps);
          const effective = overlayComboCapabilities(derived, comboRow.capabilities);
          if (effective) combo[comboRow.name] = effective;
        }
        if (alive) { setByFull(full); setById(id); setByCombo(combo); }
      } catch { /* ignore */ }
    })();
    return () => { alive = false; };
  }, [enabled]);
 
  // Resolve caps from a "provider/model" string, a bare model id, or a locally-derived combo name.
  // Custom overrides merge over /api/models; if absent, fall back to static/provider-pattern.
  const getCaps = (key) => {
    if (!key) return null;
    if (byFull[key]) return byFull[key];
    if (byCombo[key]) return byCombo[key];
    const bare = key.includes("/") ? key.slice(key.indexOf("/") + 1) : key;
    if (byId[bare]) return byId[bare];
    const provider = key.includes("/") ? key.slice(0, key.indexOf("/")) : null;
    const c = getCapabilitiesForModel(provider, bare);
    return { vision: c.vision, search: c.search, reasoning: c.reasoning, tools: c.tools, contextWindow: c.contextWindow };
  };

  return { getCaps };
}

