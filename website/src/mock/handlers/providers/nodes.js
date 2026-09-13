// /api/provider-nodes (compatible + custom embedding nodes) and
// /api/connection-groups.
import { reply, notFound, badRequest } from "../../http.js";
import { CONNECTIONS, GROUPS, NODES } from "./shared.js";

const NODE_PREFIX = {
  "openai-compatible": "openai-compatible-",
  "anthropic-compatible": "anthropic-compatible-",
  "custom-embedding": "custom-embedding-",
};
const GROUP_NAME = /^[A-Za-z0-9 ._-]{1,64}$/;

function trimBaseUrl(type, baseUrl) {
  const clean = String(baseUrl || "").trim().replace(/\/$/, "");
  if (type === "anthropic-compatible") return clean.replace(/\/messages$/, "");
  if (type === "custom-embedding") return clean.replace(/\/embeddings$/, "");
  return clean;
}

function nodeError(body, type) {
  if (!body.name?.trim()) return "Name is required";
  if (!body.prefix?.trim()) return "Prefix is required";
  if (type === "openai-compatible" && !["chat", "responses"].includes(body.apiType)) return "Invalid OpenAI compatible API type";
  return null;
}

function shortId() {
  return Math.random().toString(36).slice(2, 10);
}

export default function registerNodes(router, { store }) {
  router.get("/api/provider-nodes", () => ({ nodes: store.list(NODES) }));

  router.post("/api/provider-nodes", ({ body = {} }) => {
    const type = body.type || "openai-compatible";
    if (!NODE_PREFIX[type]) return badRequest("Invalid provider node type");
    const error = nodeError(body, type);
    if (error) return badRequest(error);
    const now = new Date().toISOString();
    const id = type === "openai-compatible" ? `${NODE_PREFIX[type]}${body.apiType}-${shortId()}` : `${NODE_PREFIX[type]}${shortId()}`;
    const node = {
      id,
      type,
      name: body.name.trim(),
      prefix: body.prefix.trim(),
      baseUrl: trimBaseUrl(type, body.baseUrl || (type === "anthropic-compatible" ? "https://api.anthropic.com/v1" : "https://api.openai.com/v1")),
      ...(type === "openai-compatible" ? { apiType: body.apiType } : null),
      ...(body.iconUrl ? { iconUrl: String(body.iconUrl).trim() } : null),
      createdAt: now,
      updatedAt: now,
    };
    store.insert(NODES, node);
    return reply({ node }, { status: 201 });
  });

  router.post("/api/provider-nodes/validate", ({ body = {} }) => {
    if (!body.baseUrl || !body.apiKey) return badRequest("Base URL and API key required");
    try {
      new URL(body.baseUrl);
    } catch {
      return badRequest("Invalid URL format");
    }
    if (/invalid|wrong/i.test(body.apiKey)) return { valid: false, error: "API key unauthorized" };
    return body.type === "custom-embedding" ? { valid: true, method: "embeddings", dimensions: 1024 } : { valid: true };
  });

  router.put("/api/provider-nodes/:id", ({ params, body = {} }) => {
    const node = store.find(NODES, params.id);
    if (!node) return notFound("Provider node not found");
    const error = nodeError(body, node.type);
    if (error) return badRequest(error);
    if (!body.baseUrl?.trim()) return badRequest("Base URL is required");
    const updated = store.patch(NODES, params.id, {
      name: body.name.trim(),
      prefix: body.prefix.trim(),
      baseUrl: trimBaseUrl(node.type, body.baseUrl),
      ...(node.type === "openai-compatible" ? { apiType: body.apiType } : null),
      ...(body.iconUrl !== undefined ? { iconUrl: String(body.iconUrl).trim() } : null),
      updatedAt: new Date().toISOString(),
    });
    store.set(CONNECTIONS, store.list(CONNECTIONS).map((c) => (c.provider === params.id
      ? { ...c, providerSpecificData: { ...(c.providerSpecificData || {}), prefix: updated.prefix, baseUrl: updated.baseUrl, nodeName: updated.name, ...(updated.apiType ? { apiType: updated.apiType } : null) } }
      : c)));
    return { node: updated };
  });

  router.delete("/api/provider-nodes/:id", ({ params }) => {
    if (!store.remove(NODES, params.id)) return notFound("Provider node not found");
    store.set(CONNECTIONS, store.list(CONNECTIONS).filter((c) => c.provider !== params.id));
    return { success: true };
  });

  const validGroupBody = (body, { partial }) => {
    if (!body || typeof body !== "object") return "Invalid JSON body";
    if ((!partial || body.name !== undefined) && !GROUP_NAME.test(String(body.name || ""))) {
      return "name must be 1-64 chars of letters, digits, space, dot, dash, underscore";
    }
    if (body.connectionIds !== undefined && !Array.isArray(body.connectionIds)) return "connectionIds must be an array";
    return null;
  };

  router.get("/api/connection-groups", () => ({ groups: store.list(GROUPS) }));

  router.post("/api/connection-groups", ({ body }) => {
    const error = validGroupBody(body, { partial: false });
    if (error) return badRequest(error);
    if (store.list(GROUPS).some((group) => group.name === body.name)) {
      return reply({ error: "A connection group with this name already exists", code: "duplicate_name" }, { status: 400 });
    }
    const now = new Date().toISOString();
    const group = { id: store.newId("group"), name: body.name, description: body.description ?? null, connectionIds: body.connectionIds || [], createdAt: now, updatedAt: now };
    store.insert(GROUPS, group);
    return reply(group, { status: 201 });
  });

  router.get("/api/connection-groups/:id", ({ params }) => store.find(GROUPS, params.id) || notFound("Connection group not found"));

  router.put("/api/connection-groups/:id", ({ params, body }) => {
    const error = validGroupBody(body, { partial: true });
    if (error) return badRequest(error);
    if (!store.find(GROUPS, params.id)) return notFound("Connection group not found");
    const changes = Object.fromEntries(["name", "description", "connectionIds"].filter((key) => body[key] !== undefined).map((key) => [key, body[key]]));
    return store.patch(GROUPS, params.id, { ...changes, updatedAt: new Date().toISOString() });
  });

  router.delete("/api/connection-groups/:id", ({ params }) => {
    if (!store.remove(GROUPS, params.id)) return notFound("Connection group not found");
    return new Response(null, { status: 204 });
  });
}
