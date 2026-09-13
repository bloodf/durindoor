// /api/models catalog endpoints, /api/pricing and /api/health/providers.
import { reply, notFound, badRequest, textStream } from "../../http.js";
import { AI_MODELS } from "@/shared/constants/config";
import { getProviderAlias } from "@/shared/constants/providers";
import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";
import { getDefaultPricing } from "open-sse/providers/pricing.js";
import { MODEL_ALIASES } from "../../fixtures/world.js";
import { HEALTH_OVERRIDES } from "../../fixtures/providers/catalog.js";
import { CONNECTIONS, CUSTOM_MODELS, DISABLED_MODELS, PRICING, connections, hasActiveLock, latencyFor } from "./shared.js";

const MODEL_ALIAS_BY_TARGET = Object.fromEntries(Object.entries(MODEL_ALIASES).map(([alias, target]) => [target, alias]));

function sameCustom(entry, { providerAlias, id, type = "llm" }) {
  return entry.providerAlias === providerAlias && entry.id === id && (entry.type || "llm") === type;
}

// Most pings pass; models whose id hints at a retired or gated tier fail.
function pingResult(model) {
  const failing = /(preview-old|deprecated|codex-mini|goldeneye)/i.test(model);
  const latencyMs = latencyFor(model);
  return failing
    ? { ok: false, latencyMs, error: "HTTP 404: model not available on this account", status: 404 }
    : { ok: true, latencyMs, error: null, status: 200 };
}

function mergePricing(overrides) {
  const defaults = getDefaultPricing();
  const providers = new Set([...Object.keys(defaults), ...Object.keys(overrides)]);
  return Object.fromEntries([...providers].map((provider) => {
    const models = { ...(defaults[provider] || {}) };
    for (const [model, rates] of Object.entries(overrides[provider] || {})) models[model] = { ...(models[model] || {}), ...rates };
    return [provider, models];
  }));
}

function healthRow(connection) {
  const override = HEALTH_OVERRIDES[connection.id];
  const base = { id: connection.id, provider: connection.provider, name: connection.name || connection.email || connection.provider };
  if (override) return { ...base, ...override };
  if (connection.testStatus === "error" || connection.testStatus === "expired") {
    return { ...base, state: "down", statusCode: Number(connection.errorCode) || 401, latencyMs: latencyFor(connection.id), error: connection.lastError || "Probe failed" };
  }
  if (connection.testStatus === "unavailable" && hasActiveLock(connection)) {
    return { ...base, state: "degraded", statusCode: 429, latencyMs: latencyFor(connection.id), error: connection.lastError || "Rate limited" };
  }
  return { ...base, state: "healthy", statusCode: 200, latencyMs: latencyFor(connection.id), error: null };
}

export default function registerModels(router, { store }) {
  router.get("/api/models", () => {
    const disabled = store.get(DISABLED_MODELS) || {};
    const models = AI_MODELS
      .filter((m) => !(disabled[getProviderAlias(m.provider) || m.provider] || disabled[m.provider] || []).includes(m.model))
      .map((m) => {
        const fullModel = `${m.provider}/${m.model}`;
        const caps = getCapabilitiesForModel(m.provider, m.model);
        return { ...m, fullModel, alias: MODEL_ALIAS_BY_TARGET[fullModel] || m.model, caps: { vision: caps.vision, search: caps.search, reasoning: caps.reasoning, contextWindow: caps.contextWindow } };
      });
    return { models };
  });

  router.put("/api/models", ({ body = {} }) => {
    if (!body.model || !body.alias) return badRequest("Model and alias required");
    return { success: true, model: body.model, alias: body.alias };
  });

  router.get("/api/models/availability", () => {
    const models = connections(store).flatMap((connection) => {
      const common = { provider: connection.provider, connectionId: connection.id, connectionName: connection.name || connection.email || connection.id, lastError: connection.lastError || null };
      const locks = Object.entries(connection).filter(([key, value]) => key.startsWith("modelLock_") && value && new Date(value).getTime() > Date.now());
      if (locks.length) return locks.map(([key, until]) => ({ ...common, model: key.slice("modelLock_".length), status: "cooldown", until }));
      return connection.testStatus === "unavailable" ? [{ ...common, model: "__all", status: "unavailable" }] : [];
    });
    return { models, unavailableCount: models.length };
  });

  router.post("/api/models/availability", ({ body = {} }) => {
    const { action, provider, model } = body;
    if (action !== "clearCooldown" || !provider || !model) return badRequest("Invalid request");
    const lockKey = `modelLock_${model}`;
    store.set(CONNECTIONS, store.list(CONNECTIONS).map((c) => (c.provider === provider && c[lockKey]
      ? { ...c, [lockKey]: null, ...(c.testStatus === "unavailable" ? { testStatus: "active", lastError: null, lastErrorAt: null, backoffLevel: 0, rateLimitedUntil: null } : null) }
      : c)));
    return { ok: true };
  });

  router.get("/api/models/custom", () => ({ models: store.list(CUSTOM_MODELS) }));

  router.post("/api/models/custom", ({ body = {} }) => {
    const { providerAlias, id, type = "llm", name, capabilities = {} } = body;
    if (!providerAlias || !id) return badRequest("providerAlias and id required");
    if (store.list(CUSTOM_MODELS).some((entry) => sameCustom(entry, { providerAlias, id, type }))) {
      return reply({ error: "Custom model already exists" }, { status: 409 });
    }
    const model = { providerAlias, id, type, name: name || id, capabilities: capabilities || {} };
    store.update(CUSTOM_MODELS, (items = []) => [...items, model]);
    return { success: true, model };
  });

  router.patch("/api/models/custom", ({ body = {} }) => {
    const { providerAlias, id, type = "llm", name, capabilities } = body;
    if (!providerAlias || !id) return badRequest("providerAlias and id required");
    const existing = store.list(CUSTOM_MODELS).find((entry) => sameCustom(entry, { providerAlias, id, type }));
    if (!existing) return notFound("Custom model not found");
    const model = { ...existing, ...(name ? { name } : null), ...(capabilities ? { capabilities } : null) };
    store.update(CUSTOM_MODELS, (items = []) => items.map((entry) => (entry === existing ? model : entry)));
    return { success: true, model };
  });

  router.delete("/api/models/custom", ({ query }) => {
    const { providerAlias, id, type = "llm" } = query;
    if (!providerAlias || !id) return badRequest("providerAlias and id required");
    store.update(CUSTOM_MODELS, (items = []) => items.filter((entry) => !sameCustom(entry, { providerAlias, id, type })));
    return { success: true };
  });

  router.get("/api/models/disabled", ({ query }) => {
    const all = store.get(DISABLED_MODELS) || {};
    return query.providerAlias ? { ids: all[query.providerAlias] || [] } : { disabled: all };
  });

  router.post("/api/models/disabled", ({ body = {} }) => {
    if (!body.providerAlias || !Array.isArray(body.ids)) return badRequest("providerAlias and ids[] required");
    store.update(DISABLED_MODELS, (all = {}) => ({ ...all, [body.providerAlias]: [...new Set([...(all[body.providerAlias] || []), ...body.ids])] }));
    return { success: true };
  });

  router.delete("/api/models/disabled", ({ query }) => {
    if (!query.providerAlias) return badRequest("providerAlias required");
    store.update(DISABLED_MODELS, (all = {}) => {
      const remaining = query.id ? (all[query.providerAlias] || []).filter((id) => id !== query.id) : [];
      const { [query.providerAlias]: _removed, ...rest } = all;
      return remaining.length ? { ...rest, [query.providerAlias]: remaining } : rest;
    });
    return { success: true };
  });

  router.post("/api/models/test", ({ body = {} }) => (body.model ? pingResult(body.model) : badRequest("Model required")));

  router.post("/api/models/test/batch", ({ body = {} }) => {
    const models = Array.isArray(body.models) ? body.models : null;
    if (!models) return badRequest("models array required");
    if (models.length > 200) return badRequest("max 200 models per batch");
    const events = models.map((item) => `data: ${JSON.stringify({ model: item.model, kind: item.kind, ...pingResult(String(item.model)) })}\n\n`);
    return textStream([...events, `data: ${JSON.stringify({ done: true })}\n\n`], { intervalMs: 140 });
  });

  router.get("/api/pricing", () => mergePricing(store.get(PRICING) || {}));

  const savePricing = ({ body }) => {
    if (!body || typeof body !== "object" || Array.isArray(body)) return badRequest("Invalid pricing data format");
    const defaults = getDefaultPricing();
    // Only persist rates that differ from the defaults, like the pricing repo.
    const overrides = Object.fromEntries(Object.entries(body).map(([provider, models]) => [
      provider,
      Object.fromEntries(Object.entries(models || {}).filter(([model, rates]) => JSON.stringify(rates) !== JSON.stringify(defaults[provider]?.[model]))),
    ]).filter(([, models]) => Object.keys(models).length));
    store.set(PRICING, overrides);
    return mergePricing(overrides);
  };
  router.patch("/api/pricing", savePricing);
  router.put("/api/pricing", savePricing);

  router.delete("/api/pricing", ({ query }) => {
    const { provider, model } = query;
    store.update(PRICING, (all = {}) => {
      if (!provider) return {};
      if (!model) return Object.fromEntries(Object.entries(all).filter(([key]) => key !== provider));
      const { [model]: _removed, ...rest } = all[provider] || {};
      return { ...all, [provider]: rest };
    });
    return mergePricing(store.get(PRICING) || {});
  });

  router.get("/api/health/providers", () => {
    const providers = connections(store).filter((c) => c.isActive !== false).map(healthRow);
    const summary = providers.reduce((acc, row) => ({ ...acc, [row.state]: (acc[row.state] || 0) + 1 }),
      { healthy: 0, degraded: 0, down: 0, blocked: 0, unconfigured: 0, unknown: 0, quotaUnavailable: 0, total: providers.length });
    return { timestamp: new Date().toISOString(), summary, providers };
  });

  router.delete("/api/health/providers", () => ({ ok: true }));
}
