import { describe, it, expect } from "vitest";
import {
  deleteConnection,
  deleteConnections,
  bulkDeleteFailureMessage,
} from "../../src/app/(dashboard)/dashboard/providers/[id]/connectionDelete.js";

const SCOPE_MESSAGE = "Cannot delete provider connection: it is the last scoped account for an API key.";

// Route stand-in: `outcomes` maps a connection id to a status and body.
function fakeFetch(outcomes) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, method: init?.method });
    const id = url.split("/").pop();
    const outcome = outcomes[id] || { status: 200, body: { message: "Connection deleted successfully" } };
    if (outcome.throws) throw new Error(outcome.throws);
    return new Response(JSON.stringify(outcome.body), { status: outcome.status });
  };
  return { impl, calls };
}

describe("single provider-connection delete", () => {
  it("reports success for a 200", async () => {
    const { impl, calls } = fakeFetch({});
    await expect(deleteConnection("c1", impl)).resolves.toEqual({ id: "c1", ok: true, error: null });
    expect(calls).toEqual([{ url: "/api/providers/c1", method: "DELETE" }]);
  });

  it("surfaces the route's error message for a non-OK response", async () => {
    const { impl } = fakeFetch({ c1: { status: 409, body: { error: SCOPE_MESSAGE } } });
    await expect(deleteConnection("c1", impl)).resolves.toEqual({ id: "c1", ok: false, error: SCOPE_MESSAGE });
  });

  it("falls back to the HTTP status and to network errors", async () => {
    const { impl } = fakeFetch({ c1: { status: 500, body: {} }, c2: { throws: "network down" } });
    await expect(deleteConnection("c1", impl)).resolves.toMatchObject({ ok: false, error: "Delete failed (HTTP 500)" });
    await expect(deleteConnection("c2", impl)).resolves.toMatchObject({ ok: false, error: "network down" });
  });
});

describe("bulk provider-connection delete", () => {
  it("returns only the ids that deleted and keeps each failure with its reason", async () => {
    const { impl } = fakeFetch({
      b: { status: 409, body: { error: SCOPE_MESSAGE } },
      c: { status: 500, body: { error: "Failed to delete connection" } },
    });
    const result = await deleteConnections(["a", "b", "c", "d"], impl);
    expect(result.deletedIds).toEqual(["a", "d"]);
    expect(result.failures).toEqual([
      { id: "b", ok: false, error: SCOPE_MESSAGE },
      { id: "c", ok: false, error: "Failed to delete connection" },
    ]);
    expect(bulkDeleteFailureMessage(result)).toBe(
      `Deleted 2 connection(s), 2 failed: ${SCOPE_MESSAGE}; Failed to delete connection`
    );
  });
});
