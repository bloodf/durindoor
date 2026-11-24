import { isString, isObject } from "@/shared/utils/typeChecks";
// /api/keys, /api/keys/:id, /api/keys/:id/reveal and /api/keys/policy-catalog.
import { badRequest, notFound, reply } from "../../http.js";
import { MACHINE_ID } from "../../fixtures/world.js";
import { CONNECTIONS } from "../providers/shared.js";
import { buildPolicyCatalog, randomSecret, seedApiKeys } from "../../fixtures/configData.js";

const KEYS = "config.apiKeys";
const EMPTY_USAGE = Object.freeze({ totalTokens: 0, totalCost: 0, totalRequests: 0, updatedAt: null });

// List/detail responses never carry the secret (toApiKeyManagementView).
function managementView(record) {
  const { key, ...safe } = record;
  return { ...safe, maskedKey: "sk-••••••••" };
}

// Resolve scopes at request time so account edits and deletions are authoritative.
function providerOptions(store) {
  return store.list(CONNECTIONS).map(({ id, name, provider }) => ({ id, name, provider }));
}

function readScope(store, body) {
  if (!("providerConnectionIds" in body)) return { value: undefined };
  const ids = body.providerConnectionIds;
  if (!Array.isArray(ids) || ids.some((id) => !isString(id) || !id.trim())) {
    return { error: "providerConnectionIds must be an array of provider connection id strings" };
  }
  const trimmed = ids.map((id) => id.trim());
  if (new Set(trimmed).size !== trimmed.length) return { error: "providerConnectionIds must not contain duplicates" };
  const known = new Set(store.list(CONNECTIONS).map((connection) => connection.id));
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
  store.define("config.keyGroups", []);

  router.get("/api/keys", () => ({
    groups: store.list("config.keyGroups"),
    providerConnections: providerOptions(store),
    keys: store.list(KEYS).map(managementView),
  }));

  router.post("/api/keys", ({ body }) => {
    if (!body || !isObject(body) || Array.isArray(body)) return badRequest("Invalid JSON body");
    const name = isString(body.name) ? body.name.trim() : "";
    if (!name) return badRequest("Name is required");
    const scope = readScope(store, body);
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
      groupIds: Array.isArray(body.groupIds) ? body.groupIds : [],
      usage: { ...EMPTY_USAGE },
    });
    return reply(record, { status: 201 });
  });

  // Group labels and key limit snapshots use the same response envelopes as the gateway.
  router.get("/api/key-groups", () => ({ groups: store.list("config.keyGroups") }));
  router.post("/api/key-groups", ({ body = {} }) => {
    if (!isString(body.name) || !body.name.trim()) return badRequest("Name is required");
    const group = store.insert("config.keyGroups", { id: store.newId("group"), name: body.name.trim(), color: body.color || null, createdAt: new Date().toISOString() });
    return reply({ group }, { status: 201 });
  });
  router.get("/api/key-groups/:id", ({ params }) => {
    const group = store.find("config.keyGroups", params.id);
    return group ? { group } : notFound("Group not found");
  });
  router.put("/api/key-groups/:id", ({ params, body = {} }) => {
    const group = store.patch("config.keyGroups", params.id, body);
    return group ? { group } : notFound("Group not found");
  });
  router.delete("/api/key-groups/:id", ({ params }) => {
    if (!store.remove("config.keyGroups", params.id)) return notFound("Group not found");
    store.set(KEYS, store.list(KEYS).map((key) => ({ ...key, groupIds: (key.groupIds || []).filter((id) => id !== params.id) })));
    return { success: true };
  });
  router.get("/api/keys/usage", ({ query }) => {
    const keys = store.list(KEYS).filter((key) => !query.apiKeyId || key.id === query.apiKeyId);
    if (query.apiKeyId && !keys.length) return notFound("Key not found");
    return { usage: Object.fromEntries(keys.map((key) => [key.id, { rpm: null, tpm: null, limits: [] }])) };
  });
  router.post("/api/keys/:id/rotate", ({ params }) => {
    if (!store.find(KEYS, params.id)) return notFound("Key not found");
    const record = store.patch(KEYS, params.id, { key: randomSecret() });
    return reply({ ...managementView(record), key: record.key, groupIds: record.groupIds || [] }, { headers: { "Cache-Control": "no-store" } });
  });

  router.get("/api/keys/policy-catalog", () => ({ models: buildPolicyCatalog() }));

  router.get("/api/keys/:id", ({ params }) => {
    const record = store.find(KEYS, params.id);
    return record ? { key: managementView(record) } : notFound("Key not found");
  });

  const update = ({ params, body }) => {
    if (!body || !isObject(body) || Array.isArray(body)) return badRequest("Invalid JSON body");
    const existing = store.find(KEYS, params.id);
    if (!existing) return notFound("Key not found");
    const changes = {};
    if ("name" in body) {
      const name = isString(body.name) ? body.name.trim() : "";
      if (!name) return badRequest("Name is required");
      changes.name = name;
    }
    if (body.isActive !== undefined) changes.isActive = body.isActive === true;
    if (body.allowedCombos !== undefined) changes.allowedCombos = Array.isArray(body.allowedCombos) ? body.allowedCombos : [];
    const scope = readScope(store, body);
    const limit = readDailyLimit(body.dailyLimitTokens);
    const expiry = readExpiry(body.expiresAt);
    const error = scope.error || limit.error || expiry.error;
    if (error) return badRequest(error);
    if (scope.value !== undefined) changes.providerConnectionIds = scope.value;
    if (Array.isArray(body.groupIds)) changes.groupIds = body.groupIds;
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
