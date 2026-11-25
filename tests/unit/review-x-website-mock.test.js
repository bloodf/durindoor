import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRouter } from "../../website/src/mock/router.js";
import { toResponse } from "../../website/src/mock/http.js";
import { registerAll } from "../../website/src/mock/handlers/index.js";
import { resetDemoData, store } from "../../website/src/mock/store.js";

let router;

function browserStorage() {
  const entries = new Map();
  return {
    get length() { return entries.size; },
    key: (index) => [...entries.keys()][index] ?? null,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, String(value)),
    removeItem: (key) => entries.delete(key),
  };
}

async function request(method, path, body) {
  const url = new URL(path, "https://demo.local");
  const found = router.match(method, url.pathname);
  expect(found, `${method} ${path}`).not.toBeNull();
  const result = await found.route.handler({
    method, url, params: found.params,
    query: Object.fromEntries(url.searchParams), searchParams: url.searchParams, body,
  });
  const response = toResponse(result);
  expect(response.status, `${method} ${path}`).toBeGreaterThanOrEqual(200);
  expect(response.status, `${method} ${path}`).toBeLessThan(300);
  return response.json();
}

beforeEach(() => {
  vi.stubGlobal("localStorage", browserStorage());
  resetDemoData();
  router = createRouter();
  registerAll(router, { store, external: () => {} });
});

afterEach(() => {
  resetDemoData();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("website demo mock coverage for issue 2304", () => {
  it("serves every requested UI route from private mock state", async () => {
    const presets = await request("GET", "/api/combos/presets?source=claude");
    expect(presets).toMatchObject({ source: "claude", items: expect.any(Array), toCreate: expect.any(Number), toSkip: expect.any(Number) });

    const createdGroup = await request("POST", "/api/key-groups", { name: "Demo group", color: "blue" });
    expect(createdGroup.group).toMatchObject({ name: "Demo group", color: "blue" });
    const groups = await request("GET", "/api/key-groups");
    expect(groups.groups).toContainEqual(createdGroup.group);
    const updatedGroup = await request("PUT", `/api/key-groups/${createdGroup.group.id}`, { name: "Updated demo group" });
    expect(updatedGroup.group.name).toBe("Updated demo group");

    const enabled = await request("GET", "/api/models/enabled");
    expect(enabled).toHaveProperty("enabled");
    const usage = await request("GET", "/api/keys/usage");
    expect(usage).toHaveProperty("usage");
    const key = (await request("GET", "/api/keys")).keys[0];
    const rotated = await request("POST", `/api/keys/${key.id}/rotate`, {});
    expect(rotated).toMatchObject({ id: key.id, key: expect.any(String), usage: expect.any(Object), groupIds: expect.any(Array) });
    expect(rotated.key).not.toContain("••");

    const connectionId = store.list("providers.connections")[0].id;
    const readiness = await request("GET", `/api/providers/${connectionId}/readiness`);
    expect(readiness).toMatchObject({ provider: connectionId, authentication: { status: expect.any(String) }, inference: { status: expect.any(String) } });
    expect(await request("DELETE", `/api/key-groups/${createdGroup.group.id}`)).toEqual({ success: true });
  });
});
