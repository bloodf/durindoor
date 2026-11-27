import { describe, expect, it } from "vitest";
import { createRouter } from "../../website/src/mock/router.js";
import { registerAll } from "../../website/src/mock/handlers/index.js";
import { store } from "../../website/src/mock/store.js";
import { CONNECTIONS } from "../../website/src/mock/handlers/providers/shared.js";

describe("public demo Firefly host setup", () => {
  const router = createRouter();
  registerAll(router, { store, external: () => {} });
  const call = (method, id) => {
    const hit = router.match(method, `/api/providers/${id}/firefly-setup`);
    expect(hit).not.toBeNull();
    return hit.route.handler({ params: hit.params, body: { open: true, profilePath: "/tmp/x" }, query: {} });
  };

  it("reports host browser control unavailable for every action without inventing state", () => {
    store.list(CONNECTIONS);
    store.insert(CONNECTIONS, { id: "demo-firefly", provider: "adobe-firefly-web", authType: "none", name: "Firefly", providerSpecificData: {} });
    try {
      for (const method of ["GET", "POST", "DELETE"]) {
        const result = call(method, "demo-firefly");
        expect(result.status).toBe(501);
        expect(result.body).toEqual({ error: expect.stringMatching(/unavailable in the public demo/), outcome: "unavailable", open: false });
        expect(JSON.stringify(result.body)).not.toMatch(/signed|logged|profilePath|cookie|token|\/tmp/i);
      }
    } finally {
      store.remove(CONNECTIONS, "demo-firefly");
    }
  });

  it("refuses unknown and non-Firefly connections", () => {
    const other = store.list(CONNECTIONS).find((row) => row.provider !== "adobe-firefly-web");
    for (const id of ["missing-connection", other.id]) {
      const result = call("POST", id);
      expect(result.status).toBe(404);
    }
  });
});
