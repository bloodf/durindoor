"use client";

import { useState, useEffect } from "react";
import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";

// Fetch model capabilities once and expose a lookup by fullModel ("provider/model") or bare model id.
export function useModelCaps() {
  const [byFull, setByFull] = useState({});
  const [byId, setById] = useState({});

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/models");
        const customRes = await fetch("/api/models/custom");
        if (!res.ok) return;
        const data = await res.json();
        const customData = customRes.ok ? await customRes.json() : { models: [] };
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
        if (alive) { setByFull(full); setById(id); }
      } catch { /* ignore */ }
    })();
    return () => { alive = false; };
  }, []);

  // Resolve caps from a "provider/model" string or a bare model id.
  // Custom overrides merge over /api/models; if absent, fall back to static/provider-pattern.
  const getCaps = (key) => {
    if (!key) return null;
    if (byFull[key]) return byFull[key];
    const bare = key.includes("/") ? key.slice(key.indexOf("/") + 1) : key;
    if (byId[bare]) return byId[bare];
    const provider = key.includes("/") ? key.slice(0, key.indexOf("/")) : null;
    const c = getCapabilitiesForModel(provider, bare);
    return { vision: c.vision, search: c.search, reasoning: c.reasoning, tools: c.tools };
  };

  return { getCaps };
}
