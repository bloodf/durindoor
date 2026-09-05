import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCombos: vi.fn(),
  createCombo: vi.fn(),
  getComboByName: vi.fn(),
  getComboById: vi.fn(),
  updateCombo: vi.fn(),
  deleteCombo: vi.fn(),
  resetComboRotation: vi.fn(),
  resetComboScoring: vi.fn(),
}));


vi.mock("next/server", () => ({
  NextResponse: {
    json(body, init = {}) {
      return new Response(JSON.stringify(body), {
        status: init.status || 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  },
}));

vi.mock("@/lib/localDb", () => ({
  getCombos: mocks.getCombos,
  createCombo: mocks.createCombo,
  getComboByName: mocks.getComboByName,
  getComboById: mocks.getComboById,
  updateCombo: mocks.updateCombo,
  deleteCombo: mocks.deleteCombo,
  ComboMemberError: class ComboMemberError extends Error {},
  validateConnectionIds: vi.fn((ids) => ids),
  ConnectionGroupValidationError: class ConnectionGroupValidationError extends Error {},
}));

vi.mock("open-sse/services/combo.js", () => ({
  resetComboRotation: mocks.resetComboRotation,
  resetComboScoring: mocks.resetComboScoring,
}));

import { GET, POST } from "../../src/app/api/combos/route.js";
import { PUT } from "../../src/app/api/combos/[id]/route.js";

const URL = "http://localhost/api/combos";

function malformedJsonRequest(url, method) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: "not-json",
  });
}

function jsonRequest(url, body, method) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const params = (id) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  // Silence expected error logging from the downstream-500 controls.
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/combos — malformed JSON boundary", () => {
  it("returns 400 (not 500) on an unparseable JSON body", async () => {
    const res = await POST(malformedJsonRequest(URL, "POST"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid JSON body" });
    // Parse failed at the boundary: no DB work attempted.
    expect(mocks.createCombo).not.toHaveBeenCalled();
  });

  it("returns 400 on a well-formed but non-object JSON body", async () => {
    // `["a"]` parses but would crash destructuring/property access downstream.
    const res = await POST(jsonRequest(URL, ["a"], "POST"));
    expect(res.status).toBe(400);
    expect(mocks.createCombo).not.toHaveBeenCalled();
  });

  it("creates the combo (201) on a valid body — happy path unregressed", async () => {
    mocks.getComboByName.mockResolvedValue(null);
    mocks.createCombo.mockResolvedValue({ id: "c1", name: "alpha", models: [] });
    const res = await POST(jsonRequest(URL, { name: "alpha", models: [] }, "POST"));
    expect(res.status).toBe(201);
    expect(mocks.createCombo).toHaveBeenCalledTimes(1);
  });

  it("still returns 500 when a downstream handler step throws (handler-error control)", async () => {
    // A valid body that gets PAST the boundary: a DB rejection must keep the
    // pre-existing generic-500 behavior, not be flattened to a 400.
    mocks.getComboByName.mockRejectedValue(new Error("db exploded"));
    const res = await POST(jsonRequest(URL, { name: "alpha", models: [] }, "POST"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Failed to create combo" });
  });
});
describe("combo member validation — POST/PUT 400 mapping", () => {
  it("POST returns 400 when the repo throws ComboMemberError", async () => {
    const { ComboMemberError } = await import("@/lib/localDb");
    mocks.getComboByName.mockResolvedValue(null);
    mocks.createCombo.mockRejectedValue(new ComboMemberError("Each combo member weight must be a positive finite number"));
    const res = await POST(jsonRequest(URL, { name: "alpha", models: ["p/a"], members: [{ id: "p/a", weight: 0 }] }, "POST"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/positive finite number/);
  });
  it("PUT returns 400 when the repo throws ComboMemberError", async () => {
    const { ComboMemberError } = await import("@/lib/localDb");
    mocks.getComboById.mockResolvedValue({ id: "c1", name: "alpha" });
    mocks.updateCombo.mockRejectedValue(new ComboMemberError("Combo members must match models"));
    const res = await PUT(jsonRequest(`${URL}/c1`, { models: ["p/a", "p/b"], members: [{ id: "p/a", weight: 1 }] }, "PUT"), params("c1"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/match models/);
  });
});

describe("combo capability ceiling API boundary", () => {
  it("POST persists a valid capability ceiling and returns it", async () => {
    mocks.getComboByName.mockResolvedValue(null);
    mocks.createCombo.mockImplementation(async (combo) => ({ id: "c1", ...combo }));
    const res = await POST(jsonRequest(URL, {
      name: "bounded",
      models: ["opencode-go/mimo-v2.5"],
      capabilities: { vision: false, contextWindow: 100000 },
    }, "POST"));
    expect(res.status).toBe(201);
    expect(mocks.createCombo).toHaveBeenCalledWith(expect.objectContaining({
      capabilities: { vision: false, contextWindow: 100000 },
    }));
    expect((await res.json()).capabilities).toEqual({ vision: false, contextWindow: 100000 });
  });

  it("POST leaves capabilities null when the field is omitted", async () => {
    mocks.getComboByName.mockResolvedValue(null);
    mocks.createCombo.mockImplementation(async (combo) => ({ id: "c1", ...combo }));
    const res = await POST(jsonRequest(URL, { name: "derived" }, "POST"));
    expect(res.status).toBe(201);
    expect(mocks.createCombo).toHaveBeenCalledWith(expect.objectContaining({ capabilities: null }));
  });

  it("PUT rejects invalid capability values before persisting", async () => {
    const res = await PUT(jsonRequest(`${URL}/c1`, { capabilities: { vision: "yes" } }, "PUT"), params("c1"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "vision must be a boolean" });
    expect(mocks.updateCombo).not.toHaveBeenCalled();
  });

  it("GET reload reflects the persisted capability ceiling after PUT", async () => {
    mocks.getComboByName.mockResolvedValue(null);
    mocks.getComboById.mockResolvedValue({ id: "c1", name: "bounded", capabilities: null });
    mocks.updateCombo.mockResolvedValue({ id: "c1", name: "bounded", capabilities: { vision: false } });
    const putRes = await PUT(jsonRequest(`${URL}/c1`, { capabilities: { vision: false } }, "PUT"), params("c1"));
    expect(putRes.status).toBe(200);
    expect((await putRes.json()).capabilities).toEqual({ vision: false });
    expect(mocks.updateCombo).toHaveBeenCalledWith("c1", { capabilities: { vision: false } });

    mocks.getCombos.mockResolvedValue([{ id: "c1", name: "bounded", capabilities: { vision: false } }]);
    const getRes = await GET();
    expect(getRes.status).toBe(200);
    expect((await getRes.json()).combos).toEqual([{ id: "c1", name: "bounded", capabilities: { vision: false } }]);
  });
});

describe("PUT /api/combos/[id] — malformed JSON boundary", () => {
  it("returns 400 (not 500) on an unparseable JSON body", async () => {
    const res = await PUT(malformedJsonRequest(`${URL}/c1`, "PUT"), params("c1"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid JSON body" });
    expect(mocks.updateCombo).not.toHaveBeenCalled();
  });

  it("returns 400 on a JSON null body", async () => {
    const res = await PUT(jsonRequest(`${URL}/c1`, null, "PUT"), params("c1"));
    expect(res.status).toBe(400);
    expect(mocks.updateCombo).not.toHaveBeenCalled();
  });

  it("updates the combo on a valid body — happy path unregressed", async () => {
    mocks.getComboByName.mockResolvedValue(null);
    mocks.getComboById.mockResolvedValue({ id: "c1", name: "alpha" });
    mocks.updateCombo.mockResolvedValue({ id: "c1", name: "beta" });
    const res = await PUT(jsonRequest(`${URL}/c1`, { name: "beta" }, "PUT"), params("c1"));
    expect(res.status).toBe(200);
    expect(mocks.updateCombo).toHaveBeenCalledTimes(1);
  });

  it("still returns 500 when a downstream handler step throws (handler-error control)", async () => {
    mocks.getComboByName.mockResolvedValue(null);
    mocks.getComboById.mockRejectedValue(new Error("db exploded"));
    const res = await PUT(jsonRequest(`${URL}/c1`, { name: "beta" }, "PUT"), params("c1"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Failed to update combo" });
  });
});
