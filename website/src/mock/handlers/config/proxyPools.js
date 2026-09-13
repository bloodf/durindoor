// /api/proxy-pools, /api/proxy-pools/:id, /:id/test and the relay deploy routes.
import { badRequest, notFound, reply, wait } from "../../http.js";
import { POOL_BINDINGS, isDeadProxy, seedProxyPools } from "../../fixtures/configData.js";

const POOLS = "config.proxyPools";
const TYPES = ["http", "vercel", "cloudflare"];

const text = (value) => (typeof value === "string" ? value.trim() : "");

function normalizeCreate(body = {}) {
  const name = text(body.name);
  const proxyUrl = text(body.proxyUrl);
  if (!name) return { error: "Name is required" };
  if (!proxyUrl) return { error: "Proxy URL is required" };
  return {
    value: {
      name,
      proxyUrl,
      noProxy: text(body.noProxy),
      isActive: body.isActive === undefined ? true : body.isActive === true,
      strictProxy: body.strictProxy === true,
      type: TYPES.includes(body.type) ? body.type : "http",
    },
  };
}

function normalizeUpdate(body = {}) {
  const value = {};
  if ("name" in body) {
    if (!text(body.name)) return { error: "Name is required" };
    value.name = text(body.name);
  }
  if ("proxyUrl" in body) {
    if (!text(body.proxyUrl)) return { error: "Proxy URL is required" };
    value.proxyUrl = text(body.proxyUrl);
  }
  if ("noProxy" in body) value.noProxy = text(body.noProxy);
  if ("isActive" in body) value.isActive = body.isActive === true;
  if ("strictProxy" in body) value.strictProxy = body.strictProxy === true;
  if ("type" in body) value.type = TYPES.includes(body.type) ? body.type : "http";
  return { value };
}

function createPool(store, fields) {
  const now = new Date().toISOString();
  return store.insert(POOLS, { id: store.newId("pool"), testStatus: null, lastTestedAt: null, lastError: null, createdAt: now, updatedAt: now, ...fields });
}

function relayName(body) {
  return text(body?.projectName) || `relay-${Date.now().toString(36)}`;
}

export default function register(router, { store }) {
  store.define(POOLS, seedProxyPools);

  router.get("/api/proxy-pools", ({ searchParams }) => {
    const activeFilter = searchParams.get("isActive");
    const pools = store.list(POOLS).filter((pool) => activeFilter === null || String(pool.isActive) === activeFilter);
    if (searchParams.get("includeUsage") !== "true") return { proxyPools: pools };
    return { proxyPools: pools.map((pool) => ({ ...pool, boundConnectionCount: POOL_BINDINGS[pool.id] || 0 })) };
  });

  router.post("/api/proxy-pools", ({ body }) => {
    const normalized = normalizeCreate(body);
    if (normalized.error) return badRequest(normalized.error);
    return reply({ proxyPool: createPool(store, normalized.value) }, { status: 201 });
  });

  router.get("/api/proxy-pools/:id", ({ params }) => {
    const pool = store.find(POOLS, params.id);
    return pool ? { proxyPool: pool } : notFound("Proxy pool not found");
  });

  const update = ({ params, body }) => {
    if (!store.find(POOLS, params.id)) return notFound("Proxy pool not found");
    const normalized = normalizeUpdate(body);
    if (normalized.error) return badRequest(normalized.error);
    return { proxyPool: store.patch(POOLS, params.id, { ...normalized.value, updatedAt: new Date().toISOString() }) };
  };
  router.put("/api/proxy-pools/:id", update);
  router.patch("/api/proxy-pools/:id", update);

  router.delete("/api/proxy-pools/:id", ({ params }) => {
    if (!store.find(POOLS, params.id)) return notFound("Proxy pool not found");
    const boundConnectionCount = POOL_BINDINGS[params.id] || 0;
    if (boundConnectionCount > 0) return reply({ error: "Proxy pool is currently in use", boundConnectionCount }, { status: 409 });
    store.remove(POOLS, params.id);
    return { success: true };
  });

  router.post("/api/proxy-pools/:id/test", async ({ params }) => {
    const pool = store.find(POOLS, params.id);
    if (!pool) return notFound("Proxy pool not found");
    const dead = isDeadProxy(pool.proxyUrl);
    await wait(dead ? 1200 : 350);
    const testedAt = new Date().toISOString();
    const error = dead ? (pool.type === "http" ? "Proxy connection refused" : "Relay test timed out") : null;
    store.patch(POOLS, pool.id, { testStatus: dead ? "error" : "active", lastTestedAt: testedAt, lastError: error, isActive: !dead });
    return {
      ok: !dead,
      status: dead ? 500 : 200,
      statusText: dead ? null : "OK",
      error,
      elapsedMs: dead ? 30000 : 180 + (pool.name.length * 17) % 240,
      testedAt,
    };
  });

  router.post("/api/proxy-pools/vercel-deploy", async ({ body }) => {
    if (!body?.vercelToken) return badRequest("Vercel API token is required");
    await wait(1500);
    const name = relayName(body);
    const deployUrl = `https://${name}.vercel.app/api/relay`;
    const proxyPool = createPool(store, { name, proxyUrl: deployUrl, type: "vercel", noProxy: "", isActive: true, strictProxy: false });
    return reply({ proxyPool, deployUrl }, { status: 201 });
  });

  router.post("/api/proxy-pools/cloudflare-deploy", async ({ body }) => {
    if (!text(body?.accountId) || !text(body?.apiToken)) return badRequest("Cloudflare Account ID and API Token are required");
    await wait(1500);
    const name = relayName(body);
    const deployUrl = `https://${name}.balin.workers.dev`;
    const proxyPool = createPool(store, { name, proxyUrl: deployUrl, type: "cloudflare", noProxy: "", isActive: true, strictProxy: false });
    return reply({ proxyPool, deployUrl }, { status: 201 });
  });
}
