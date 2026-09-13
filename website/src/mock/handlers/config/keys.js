// /api/keys, /api/keys/:id, /api/keys/:id/reveal and /api/keys/policy-catalog.
import { badRequest, notFound, reply } from "../../http.js";
import { CONNECTIONS, MACHINE_ID } from "../../fixtures/world.js";
import { buildPolicyCatalog, randomSecret, seedApiKeys } from "../../fixtures/configData.js";

const KEYS = "config.apiKeys";
const EMPTY_USAGE = Object.freeze({ totalTokens: 0, totalCost: 0, totalRequests: 0, updatedAt: null });

// List/detail responses never carry the secret (toApiKeyManagementView).
function managementView(record) {
  const { key, ...safe } = record;
  return { ...safe, maskedKey: "sk-••••••••" };
}

function providerOptions() {
  return CONNECTIONS.map(({ id, name, provider }) => ({ id, name, provider }));
}

function readScope(body) {
  if (!("providerConnectionIds" in body)) return { value: undefined };
  const ids = body.providerConnectionIds;
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string" || !id.trim())) {
    return { error: "providerConnectionIds must be an array of provider connection id strings" };
  }
  const trimmed = ids.map((id) => id.trim());
  if (new Set(trimmed).size !== trimmed.length) return { error: "providerConnectionIds must not contain duplicates" };
  const known = new Set(CONNECTIONS.map((connection) => connection.id));
  if (trimmed.some((id) => !known.has(id))) return { error: "Provider connection not found" };
  return { value: trimmed };
}

function readDailyLimit(value) {
  if (value === undefined) return { value: undefined };
  if (value === null || value === "") return { value: null };
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 0) return { error: "dailyLimitTokens must be a non-negative integer" };
  return { value: limit };
}

function readPolicy(body, existing) {
  if (body.policy !== undefined) return body.policy;
  const fields = ["allowedModels", "maxTokens", "maxCostUsd"].filter((field) => field in body);
  if (!fields.length) return undefined;
  return { ...(existing || {}), ...Object.fromEntries(fields.map((field) => [field, body[field]])) };
}

function readExpiry(value) {
  if (value === undefined || value === null || value === "") return { value: value === undefined ? undefined : null };
  const time = Date.parse(value);
  if (Number.isNaN(time)) return { error: "expiresAt must be a valid date" };
  if (time <= Date.now()) return { error: "expiresAt must be in the future" };
  return { value: new Date(time).toISOString() };
}

export default function register(router, { store }) {
  store.define(KEYS, seedApiKeys);

  router.get("/api/keys", () => ({
    providerConnections: providerOptions(),
    keys: store.list(KEYS).map(managementView),
  }));

  router.post("/api/keys", ({ body }) => {
    if (!body || typeof body !== "object" || Array.isArray(body)) return badRequest("Invalid JSON body");
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return badRequest("Name is required");
    const scope = readScope(body);
    const limit = readDailyLimit(body.dailyLimitTokens);
    const expiry = readExpiry(body.expiresAt);
    const error = scope.error || limit.error || expiry.error;
    if (error) return badRequest(error);
    const record = store.insert(KEYS, {
      id: store.newId("key"),
      key: randomSecret(),
      name,
      machineId: MACHINE_ID,
      isActive: true,
      allowedCombos: Array.isArray(body.allowedCombos) ? body.allowedCombos : [],
      dailyLimitTokens: limit.value ?? null,
      policy: readPolicy(body) ?? null,
      expiresAt: expiry.value ?? null,
      createdAt: new Date().toISOString(),
      providerConnectionIds: scope.value || [],
      usage: { ...EMPTY_USAGE },
    });
    return reply(record, { status: 201 });
  });

  router.get("/api/keys/policy-catalog", () => ({ models: buildPolicyCatalog() }));

  router.get("/api/keys/:id", ({ params }) => {
    const record = store.find(KEYS, params.id);
    return record ? { key: managementView(record) } : notFound("Key not found");
  });

  const update = ({ params, body }) => {
    if (!body || typeof body !== "object" || Array.isArray(body)) return badRequest("Invalid JSON body");
    const existing = store.find(KEYS, params.id);
    if (!existing) return notFound("Key not found");
    const changes = {};
    if ("name" in body) {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name) return badRequest("Name is required");
      changes.name = name;
    }
    if (body.isActive !== undefined) changes.isActive = body.isActive === true;
    if (body.allowedCombos !== undefined) changes.allowedCombos = Array.isArray(body.allowedCombos) ? body.allowedCombos : [];
    const scope = readScope(body);
    const limit = readDailyLimit(body.dailyLimitTokens);
    const expiry = readExpiry(body.expiresAt);
    const error = scope.error || limit.error || expiry.error;
    if (error) return badRequest(error);
    if (scope.value !== undefined) changes.providerConnectionIds = scope.value;
    if ("dailyLimitTokens" in body) changes.dailyLimitTokens = limit.value;
    if ("expiresAt" in body) changes.expiresAt = expiry.value;
    const policy = readPolicy(body, existing.policy);
    if (policy !== undefined) changes.policy = policy;
    return { key: managementView(store.patch(KEYS, existing.id, changes)) };
  };
  router.put("/api/keys/:id", update);
  router.patch("/api/keys/:id", update);

  router.delete("/api/keys/:id", ({ params }) => {
    if (!store.find(KEYS, params.id)) return notFound("Key not found");
    store.remove(KEYS, params.id);
    return { message: "Key deleted successfully" };
  });

  router.get("/api/keys/:id/reveal", ({ params }) => {
    const record = store.find(KEYS, params.id);
    return record ? { key: record.key } : notFound("Key not found");
  });
}
