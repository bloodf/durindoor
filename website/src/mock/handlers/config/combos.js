// /api/combos, /api/combos/:id and /api/models/alias.
import { badRequest, notFound, reply } from "../../http.js";
import { seedAliases, seedCombos } from "../../fixtures/configData.js";

export const COMBOS = "config.combos";
const ALIASES = "config.aliases";
const VALID_NAME = /^[a-zA-Z0-9_.-]+$/;

function stringList(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.length > 0) : [];
}

// Keep existing weights for surviving members unless explicit members are sent.
function membersFor(models, members, prior = []) {
  if (Array.isArray(members) && members.length === models.length) {
    return models.map((id, index) => ({ id, weight: Number(members[index]?.weight) > 0 ? Number(members[index].weight) : 1 }));
  }
  const weights = new Map(prior.map((member) => [member.id, member.weight]));
  return models.map((id) => ({ id, weight: weights.get(id) ?? 1 }));
}

function nameError(store, name, selfId) {
  if (!name) return "Name is required";
  if (!VALID_NAME.test(name)) return "Name can only contain letters, numbers, -, _ and .";
  const clash = store.list(COMBOS).find((combo) => combo.name === name && combo.id !== selfId);
  return clash ? "Combo name already exists" : null;
}

export default function register(router, { store }) {
  store.define(COMBOS, seedCombos);
  store.define(ALIASES, seedAliases);

  router.get("/api/combos", () => ({ combos: store.list(COMBOS) }));

  router.post("/api/combos", ({ body = {} }) => {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const error = nameError(store, name);
    if (error) return badRequest(error);
    const models = stringList(body.models);
    const now = new Date().toISOString();
    const combo = store.insert(COMBOS, {
      id: store.newId("combo"),
      name,
      kind: body.kind || null,
      models,
      members: membersFor(models, body.members),
      invariant: null,
      capabilities: body.capabilities && Object.keys(body.capabilities).length ? body.capabilities : null,
      allowedConnectionIds: stringList(body.allowedConnectionIds),
      createdAt: now,
      updatedAt: now,
    });
    return reply(combo, { status: 201 });
  });

  router.get("/api/combos/:id", ({ params }) => store.find(COMBOS, params.id) ?? notFound("Combo not found"));

  const update = ({ params, body = {} }) => {
    const existing = store.find(COMBOS, params.id);
    if (!existing) return notFound("Combo not found");
    const changes = { updatedAt: new Date().toISOString() };
    if (body.name !== undefined) {
      const name = String(body.name).trim();
      const error = nameError(store, name, existing.id);
      if (error) return badRequest(error);
      changes.name = name;
    }
    if (body.models !== undefined) {
      changes.models = stringList(body.models);
      changes.members = membersFor(changes.models, body.members, existing.members);
    }
    if (body.kind !== undefined) changes.kind = body.kind;
    if (body.capabilities !== undefined) changes.capabilities = body.capabilities && Object.keys(body.capabilities).length ? body.capabilities : null;
    if (body.allowedConnectionIds !== undefined) changes.allowedConnectionIds = [...new Set(stringList(body.allowedConnectionIds))];
    return store.patch(COMBOS, existing.id, changes);
  };
  router.put("/api/combos/:id", update);
  router.patch("/api/combos/:id", update);

  router.delete("/api/combos/:id", ({ params }) => {
    if (!store.find(COMBOS, params.id)) return notFound("Combo not found");
    store.remove(COMBOS, params.id);
    return { success: true };
  });

  // Aliases are a plain { alias: "provider-alias/model" } map.
  router.get("/api/models/alias", () => ({ aliases: store.get(ALIASES) || {} }));
  const setAlias = ({ body = {} }) => {
    const { model, alias } = body;
    if (!model || !alias) return badRequest("Model and alias required");
    store.update(ALIASES, (aliases = {}) => ({ ...aliases, [alias]: model }));
    return { success: true, model, alias };
  };
  router.put("/api/models/alias", setAlias);
  router.post("/api/models/alias", setAlias);
  router.delete("/api/models/alias", ({ searchParams, body }) => {
    const alias = searchParams.get("alias") || body?.alias;
    if (!alias) return badRequest("Alias required");
    store.update(ALIASES, (aliases = {}) => Object.fromEntries(Object.entries(aliases).filter(([key]) => key !== alias)));
    return { success: true };
  });
}
