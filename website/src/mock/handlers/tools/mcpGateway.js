// MCP gateway: upstream instances, gateway keys, grants and the OAuth login flow.
import { reply, notFound, badRequest } from "../../http.js";
import { MACHINE_ID } from "../../fixtures/world.js";
import { MCP_INSTANCES, MCP_KEYS, MCP_GRANTS, MCP_TOOLS, genericTools, gatewayKeyValue } from "../../fixtures/tools/mcpGateway.js";

const INSTANCES = "tools.mcpInstances";
const KEYS = "tools.mcpKeys";
const GRANTS = "tools.mcpGrants";

const SLUG_RE = /^[a-z0-9-]{2,40}$/;
const KINDS = new Set(["http", "sse", "npx", "python", "docker", "command"]);
const TRANSPORTS = new Set(["http", "sse", "stdio"]);

// Mirrors stripSecrets() in src/app/api/mcp-gateway/instances/route.js.
function toPublicInstance(instance) {
  const { headers: _headers, env: _env, oauthConnected, providerConnectionId, ...rest } = instance;
  return {
    ...rest,
    oauthStatus: instance.oauth ? (oauthConnected ? "connected" : "needs_login") : "none",
    oauthClientConfigured: false,
    hasProviderConnection: Boolean(providerConnectionId),
  };
}

function toPublicKey(record) {
  const { key: _key, ...rest } = record;
  return rest;
}

function validateInstance(body, { partial = false } = {}) {
  const errors = [];
  if (!partial || body.slug !== undefined) {
    if (!body.slug || !SLUG_RE.test(body.slug)) errors.push("slug must match ^[a-z0-9-]{2,40}$");
    if (body.slug?.includes("__")) errors.push("slug cannot contain __ (reserved as tool-name separator)");
  }
  if (partial) return errors;
  if (!KINDS.has(body.kind)) errors.push(`kind must be one of: ${[...KINDS].join(", ")}`);
  const transport = body.transport || (body.kind === "http" || body.kind === "sse" ? body.kind : "stdio");
  if (!TRANSPORTS.has(transport)) errors.push(`transport must be one of: ${[...TRANSPORTS].join(", ")}`);
  if (transport === "stdio" ? !body.command : !body.url) {
    errors.push(transport === "stdio" ? "command is required for stdio transport" : "url is required for http/sse transport");
  }
  return errors;
}

function slugTaken(store, slug, exceptId) {
  return store.list(INSTANCES).some((item) => item.slug === slug && item.id !== exceptId);
}

function pickInstanceFields(body) {
  const allowed = ["slug", "title", "kind", "transport", "url", "command", "args", "env", "headers", "oauth", "enabled", "providerConnectionId"];
  return Object.fromEntries(allowed.filter((field) => body[field] !== undefined).map((field) => [field, body[field]]));
}

function registerInstances(router, store) {
  router.get("/api/mcp-gateway/instances", () => ({ instances: store.list(INSTANCES).map(toPublicInstance) }));

  router.post("/api/mcp-gateway/instances", ({ body = {} }) => {
    const errors = validateInstance(body);
    if (errors.length) return badRequest(errors.join("; "));
    if (slugTaken(store, body.slug)) return reply({ error: `slug "${body.slug}" already exists` }, { status: 409 });
    const now = new Date().toISOString();
    const instance = {
      id: store.newId("mcp"),
      title: "",
      args: [],
      oauth: false,
      enabled: true,
      ...pickInstanceFields(body),
      transport: body.transport || (body.kind === "http" || body.kind === "sse" ? body.kind : "stdio"),
      createdAt: now,
      updatedAt: now,
    };
    store.insert(INSTANCES, instance);
    return reply({ instance: toPublicInstance(instance) }, { status: 201 });
  });

  router.get("/api/mcp-gateway/instances/:id", ({ params }) => {
    const instance = store.find(INSTANCES, params.id);
    return instance ? { instance: toPublicInstance(instance) } : notFound("not found");
  });

  router.put("/api/mcp-gateway/instances/:id", ({ params, body = {} }) => {
    const errors = validateInstance(body, { partial: true });
    if (errors.length) return badRequest(errors.join("; "));
    if (body.slug && slugTaken(store, body.slug, params.id)) return reply({ error: `slug "${body.slug}" already exists` }, { status: 409 });
    const updated = store.patch(INSTANCES, params.id, { ...pickInstanceFields(body), updatedAt: new Date().toISOString() });
    return updated ? { instance: toPublicInstance(updated) } : notFound("not found");
  });

  router.delete("/api/mcp-gateway/instances/:id", ({ params }) => {
    if (!store.remove(INSTANCES, params.id)) return notFound("not found");
    store.update(GRANTS, (grants = {}) =>
      Object.fromEntries(Object.entries(grants).map(([keyId, list]) => [keyId, list.filter((grant) => grant.instanceId !== params.id)])),
    );
    return { ok: true };
  });

  router.post("/api/mcp-gateway/instances/:id/test", ({ params }) => {
    const instance = store.find(INSTANCES, params.id);
    if (!instance) return reply({ error: "instance not found", ok: false }, { status: 404 });
    if (instance.oauth && !instance.oauthConnected) {
      return reply({ error: "upstream 401: instance requires re-login", ok: false }, { status: 502 });
    }
    const tools = MCP_TOOLS[instance.slug] || genericTools(instance.slug);
    return { ok: true, toolCount: tools.length, sample: tools.slice(0, 5) };
  });
}

function registerKeys(router, store) {
  router.get("/api/mcp-gateway/keys", () => ({ keys: store.list(KEYS).map(toPublicKey) }));

  router.post("/api/mcp-gateway/keys", ({ body = {} }) => {
    const random = Math.random().toString(16).slice(2, 12);
    const record = {
      id: store.newId("gwkey"),
      name: body.name ?? null,
      key: gatewayKeyValue(`${random.slice(0, 8)}-${random.slice(8, 10)}`),
      machineId: MACHINE_ID,
      isActive: true,
      createdAt: new Date().toISOString(),
    };
    store.insert(KEYS, record);
    return reply({ key: record }, { status: 201 });
  });

  // The grants modal builds a Set of instance ids from `grants`, so ids are
  // returned there and the detailed rows ride along in `grantsDetailed`.
  router.get("/api/mcp-gateway/keys/:id", ({ params, searchParams }) => {
    const record = store.find(KEYS, params.id);
    if (!record) return notFound("not found");
    const detailed = store.get(GRANTS)?.[params.id] || [];
    const reveal = searchParams?.get("reveal") === "1";
    return { key: reveal ? record : toPublicKey(record), grants: detailed.map((grant) => grant.instanceId), grantsDetailed: detailed };
  });

  router.put("/api/mcp-gateway/keys/:id", ({ params, body = {} }) => {
    if (Array.isArray(body.grants)) {
      const allowlists = Array.isArray(body.toolAllowlists) ? body.toolAllowlists : [];
      const next = body.grants.map((instanceId, index) => ({ instanceId, toolAllowlist: allowlists[index] ?? null }));
      store.update(GRANTS, (grants = {}) => ({ ...grants, [params.id]: next }));
    }
    return { ok: true };
  });

  router.delete("/api/mcp-gateway/keys/:id", ({ params }) => {
    if (!store.remove(KEYS, params.id)) return notFound("not found");
    store.update(GRANTS, (grants = {}) => Object.fromEntries(Object.entries(grants).filter(([keyId]) => keyId !== params.id)));
    return { ok: true };
  });

  router.get("/api/mcp-gateway/keys/:id/reveal", ({ params }) => {
    const record = store.find(KEYS, params.id);
    return record ? { key: record.key } : notFound("Key not found");
  });
}

// The authorize URL is a blank page so the demo never leaves the dashboard;
// the first status poll completes the login and flips the instance to connected.
function registerOauth(router, store) {
  router.get("/api/mcp-gateway/oauth/:id/authorize", ({ params }) => {
    const instance = store.find(INSTANCES, params.id);
    if (!instance) return notFound("instance not found");
    if (!instance.url) return badRequest("instance has no url");
    return { url: "about:blank", state: `demo-${params.id}-${Date.now().toString(36)}`, expiresInMs: 300000 };
  });

  router.get("/api/mcp-gateway/oauth/:id/status", ({ params, searchParams }) => {
    if (!searchParams?.get("state")) return badRequest("missing state");
    if (!store.find(INSTANCES, params.id)) return { status: "missing" };
    store.patch(INSTANCES, params.id, { oauthConnected: true, updatedAt: new Date().toISOString() });
    return { status: "complete", error: null };
  });

  router.get("/api/mcp-gateway/oauth/:id/callback", () =>
    reply("<p>Connected. You can close this tab.</p>", { contentType: "text/html" }),
  );
}

export default function registerMcpGateway(router, { store }) {
  store.define(INSTANCES, () => MCP_INSTANCES);
  store.define(KEYS, () => MCP_KEYS);
  store.define(GRANTS, () => MCP_GRANTS);
  registerInstances(router, store);
  registerKeys(router, store);
  registerOauth(router, store);
}
