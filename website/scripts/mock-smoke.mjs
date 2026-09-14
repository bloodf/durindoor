// Browser-free behavioral contracts. Run with the alias loader; a paths file
// accepts `/api/path` (GET) or `METHOD /api/path {"optional":"JSON body"}`.
// Missing routes, thrown handlers, 5xx responses and empty files fail the CLI.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createRouter } from "../src/mock/router.js";
import { store, resetDemoData } from "../src/mock/store.js";
import { registerAll } from "../src/mock/handlers/index.js";
import { toResponse } from "../src/mock/http.js";

function makeRouter() {
  const router = createRouter();
  registerAll(router, { store, external: () => {} });
  return router;
}

async function request(router, method, path, body, status = 200) {
  const url = new URL(path, "http://demo.local");
  const found = router.match(method, url.pathname);
  assert.ok(found, `Missing route: ${method} ${url.pathname}`);
  const result = await found.route.handler({ method, url, params: found.params, query: Object.fromEntries(url.searchParams), searchParams: url.searchParams, body });
  const response = toResponse(result);
  assert.equal(response.status, status, `${method} ${path}`);
  return response.json();
}

const scenarios = [
  ["password session", async (router) => {
    await request(router, "POST", "/api/auth/logout");
    assert.equal((await request(router, "GET", "/api/auth/status")).authenticated, false);
    await request(router, "POST", "/api/auth/login", { password: "wrong" }, 401);
    assert.equal((await request(router, "GET", "/api/auth/status")).authenticated, false);
    await request(router, "POST", "/api/auth/login", { password: "melon" });
    assert.equal((await request(router, "GET", "/api/auth/status")).authenticated, true);
  }],
  ["key secret and mutation", async (router) => {
    const created = await request(router, "POST", "/api/keys", { name: "smoke-key" }, 201);
    await request(router, "PATCH", `/api/keys/${created.id}`, { name: "smoke-renamed" });
    const { key } = await request(router, "GET", `/api/keys/${created.id}`);
    assert.equal(key.name, "smoke-renamed");
    assert.equal(Object.hasOwn(key, "key"), false);
    assert.equal((await request(router, "GET", `/api/keys/${created.id}/reveal`)).key, created.key);
    await request(router, "DELETE", `/api/keys/${created.id}`);
    await request(router, "GET", `/api/keys/${created.id}`, undefined, 404);
  }],
  ["combo mutation", async (router) => {
    const combo = await request(router, "POST", "/api/combos", { name: "smoke-combo", models: ["claude/claude-opus-5"] }, 201);
    await request(router, "PATCH", `/api/combos/${combo.id}`, { models: ["codex/gpt-6-astra"] });
    assert.deepEqual((await request(router, "GET", `/api/combos/${combo.id}`)).models, ["codex/gpt-6-astra"]);
    await request(router, "DELETE", `/api/combos/${combo.id}`);
    await request(router, "GET", `/api/combos/${combo.id}`, undefined, 404);
  }],
  ["selective provider import and key scope", async (router) => {
    const path = "/api/settings/database/selective";
    const row = { id: "smoke-provider", name: "Smoke imported", provider: "groq", authType: "apikey", priority: 1, isActive: true };
    const bundle = { format: "durindoor-selective-transfer", version: 1, providerConnections: [row], combos: [] };
    assert.equal((await request(router, "POST", path, { action: "preview", bundle })).providerConnections[0].action, "create");
    await request(router, "POST", path, { action: "apply", bundle });
    assert.equal((await request(router, "POST", path, { action: "preview", bundle })).providerConnections[0].action, "update");
    const exported = await request(router, "POST", path, { action: "export", selection: { providers: [row.id] } });
    assert.deepEqual(exported.providerConnections, [row]);
    const key = await request(router, "POST", "/api/keys", { name: "import-scope", providerConnectionIds: [row.id] }, 201);
    await request(router, "DELETE", `/api/providers/${row.id}`);
    await request(router, "POST", "/api/keys", { name: "stale-scope", providerConnectionIds: [row.id] }, 400);
    await request(router, "DELETE", `/api/keys/${key.id}`);
  }],
  ["live proxy binding deletion guard", async (router) => {
    const { proxyPool } = await request(router, "POST", "/api/proxy-pools", { name: "Smoke proxy", proxyUrl: "http://localhost:8080" }, 201);
    const { providerConnections } = await request(router, "GET", "/api/keys");
    const connection = providerConnections[0];
    assert.ok(connection, "Seed must contain an account");
    const { connection: original } = await request(router, "GET", `/api/providers/${connection.id}`);
    await request(router, "PATCH", `/api/providers/${connection.id}`, { proxyPoolId: proxyPool.id });
    const { proxyPools } = await request(router, "GET", "/api/proxy-pools?includeUsage=true");
    assert.equal(proxyPools.find((pool) => pool.id === proxyPool.id).boundConnectionCount, 1);
    await request(router, "DELETE", `/api/proxy-pools/${proxyPool.id}`, undefined, 409);
    await request(router, "PATCH", `/api/providers/${connection.id}`, { proxyPoolId: original.providerSpecificData?.proxyPoolId || "__none__" });
    await request(router, "DELETE", `/api/proxy-pools/${proxyPool.id}`);
  }],
];

/** Return failures as data for callers; the CLI maps any failure to exit 1. */
export async function runSmoke({ paths, router = makeRouter(), log = console.log } = {}) {
  let checked = 0;
  let missing = 0;
  let failed = 0;
  if (paths === undefined) {
    resetDemoData();
    try {
      for (const [name, scenario] of scenarios) {
        checked += 1;
        try {
          await scenario(router);
          log(`PASS ${name}`);
        } catch (error) {
          failed += 1;
          log(`FAIL ${name}: ${error.message}`);
        }
      }
    } finally {
      resetDemoData();
    }
  } else {
    if (!paths.length) {
      failed += 1;
      log("FAIL paths file is empty");
    }
    for (const raw of paths) {
      checked += 1;
      try {
        const parsed = /^(?:(GET|POST|PUT|PATCH|DELETE|HEAD)\s+)?(\/\S+)(?:\s+(.+))?$/.exec(raw);
        assert.ok(parsed, `Invalid path entry: ${raw}`);
        const [, requestedMethod, path, json] = parsed;
        const method = requestedMethod || "GET";
        const url = new URL(path, "http://demo.local");
        const found = router.match(method, url.pathname);
        if (!found) {
          missing += 1;
          log(`MISSING ${method} ${path}`);
          continue;
        }
        const response = toResponse(await found.route.handler({ method, url, params: found.params, query: Object.fromEntries(url.searchParams), searchParams: url.searchParams, body: json ? JSON.parse(json) : undefined }));
        await response.body?.cancel();
        assert.ok(response.status < 500, `Handler returned ${response.status}`);
      } catch (error) {
        failed += 1;
        log(`FAIL ${raw}: ${error.message}`);
      }
    }
  }
  const exitCode = missing || failed ? 1 : 0;
  log(`routes=${router.size()} checked=${checked} missing=${missing} failed=${failed}`);
  return { checked, missing, failed, exitCode };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const file = process.argv[2];
    const options = {};
    if (file) options.paths = readFileSync(file, "utf8").split("\n").map((line) => line.trim()).filter(Boolean);
    process.exitCode = (await runSmoke(options)).exitCode;
  } catch (error) {
    console.error(`FAIL ${error.message}`);
    process.exitCode = 1;
  }
}
