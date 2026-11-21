"use client";

import { useState, useEffect } from "react";
import { aggregateComboCapabilities, getCapabilitiesForModel, overlayComboCapabilities, resolveModelLimits } from "open-sse/providers/capabilities.js";
import { PROVIDER_ID_TO_ALIAS } from "@/shared/constants/models";
import { isString } from "@/shared/utils/typeChecks";

/**
 * Build the dashboard capability index from the local catalog.
 *
 * A custom provider is addressed by the prefix the operator configured
 * ("mirai"), not by its node id. The dashboard looks a model up under the id it
 * publishes, so the node prefix maps back to the node here: a combo member
 * keyed by the prefix resolves to that provider's capability rows, and a
 * custom override stored under the node id stays reachable under the
 * published prefix as well.
 *
 * @param {object} input
 * @param {Array} [input.models] Rows from /api/models.
 * @param {Array} [input.customModels] Rows from /api/models/custom.
 * @param {Array} [input.combos] Rows from /api/combos.
 * @param {Array} [input.providerNodes] Rows from /api/provider-nodes.
 * @returns {{byFull: object, byId: object, byCombo: object}}
 */
export function buildDashboardCapsIndex({
  models = [],
  customModels = [],
  combos = [],
  providerNodes = []
} = {}) {
  const prefixById = new Map();
  const idByPrefix = new Map();
  for (const node of providerNodes) {
    if (!isString(node?.id)) continue;
    prefixById.set(node.id, node.prefix);
    if (isString(node?.prefix) && node.prefix) idByPrefix.set(node.prefix, node.id);
  }

  const byFull = {};
  const byId = {};
  for (const m of models) {
    if (!m.caps) continue;
    if (m.fullModel) byFull[m.fullModel] = m.caps;
    if (m.model) byId[m.model] = m.caps;
  }

  // Custom overrides stay provider-scoped: only the "providerAlias/id" key is
  // written, so two providers sharing a model id never clobber each other.
  // Bare-id lookups intentionally see no custom overrides — a bare id is
  // ambiguous across providers.
  for (const m of customModels) {
    if (!m.id || !m.providerAlias) continue;
    const key = `${m.providerAlias}/${m.id}`;
    byFull[key] = { ...byFull[key], ...(m.capabilities || {}) };
    // The row is stored under the node id, but the published id is the
    // configured prefix. Keep the published form resolvable too, so a lookup
    // by the id the dashboard advertises finds the same capabilities.
    const prefix = prefixById.get(m.providerAlias);
    if (isString(prefix) && prefix && prefix !== m.providerAlias) {
      const publishedKey = `${prefix}/${m.id}`;
      byFull[publishedKey] = { ...byFull[publishedKey], ...(m.capabilities || {}) };
    }
  }

  // Combo ceilings are local data: derive them from saved members and custom
  // overrides instead of mounting the live-discovery /v1/models endpoint.
  const aliasToProviderId = Object.fromEntries([
    ...Object.entries(PROVIDER_ID_TO_ALIAS).flatMap(([providerId, alias]) => [[providerId, providerId], [alias, providerId]]),
    // A custom member id keyed by the node's prefix resolves to that provider,
    // so the dashboard derives the same combo capabilities the server
    // publishes for /v1/models.
    ...[...idByPrefix].flatMap(([prefix, providerId]) => [[prefix, providerId], [providerId, providerId]]),
  ]);
  const customCaps = new Map(
    customModels
      .filter((m) => m?.id && m?.providerAlias && m?.capabilities)
      .map((m) => [`${aliasToProviderId[m.providerAlias] ?? m.providerAlias}/${m.id}`, m.capabilities]),
  );
  const comboLookup = Object.fromEntries(
    combos.map((combo) => [combo.name, {
      models: Array.isArray(combo.models) ? combo.models.filter(isString) : [],
      capabilities: combo.capabilities,
    }]),
  );
  const byCombo = {};
  for (const comboRow of combos) {
    if (!comboRow?.name) continue;
    const derived = aggregateComboCapabilities(comboLookup[comboRow.name].models, comboLookup, aliasToProviderId, 0, customCaps);
    const effective = overlayComboCapabilities(derived, comboRow.capabilities);
    if (effective) byCombo[comboRow.name] = effective;
  }

  return { byFull, byId, byCombo };
}

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
        const [res, customRes, combosRes, nodesRes] = await Promise.all([
          fetch("/api/models"),
          fetch("/api/models/custom"),
          fetch("/api/combos"),
          fetch("/api/provider-nodes"),
        ]);
        if (!res.ok) return;
        const data = await res.json();
        const customData = customRes?.ok ? await customRes.json() : { models: [] };
        const combosData = combosRes?.ok ? await combosRes.json() : { combos: [] };
        const nodeData = nodesRes?.ok ? await nodesRes.json() : { nodes: [] };
        const index = buildDashboardCapsIndex({
          models: data.models || [],
          customModels: customData.models || [],
          combos: combosData.combos || [],
          providerNodes: nodeData.nodes || []
        });
        if (alive) { setByFull(index.byFull); setById(index.byId); setByCombo(index.byCombo); }
      } catch { /* ignore */ }
    })();
    return () => { alive = false; };
  }, [enabled]);

  // Resolve caps from a "provider/model" string, a bare model id, or a locally-derived combo name.
  // Custom overrides merge over /api/models; if absent, fall back to static/provider-pattern.
  const getCaps = (key) => {
    if (!key) return null;
    if (byCombo[key]) return byCombo[key];
    const qualified = key.includes("/");
    const bare = qualified ? key.slice(key.indexOf("/") + 1) : key;
    const provider = qualified ? key.slice(0, key.indexOf("/")) : null;
    const alias = PROVIDER_ID_TO_ALIAS[provider] || provider;
    // A qualified lookup must never inherit a sibling provider's bare-id row.
    const cached = byFull[key] || (qualified ? byFull[`${alias}/${bare}`] : byId[bare]);
    const caps = getCapabilitiesForModel(provider, bare);
    const limits = resolveModelLimits(provider, bare, null, null, null, true);
    return {
      ...caps,
      contextWindow: limits.known ? limits.contextWindow : undefined,
      maxOutput: limits.known ? limits.maxOutput : undefined,
      ...cached,
    };
  };

  return { getCaps };
}
