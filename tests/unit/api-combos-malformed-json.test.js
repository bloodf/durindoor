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
}));

vi.mock("open-sse/services/combo.js", () => ({
  resetComboRotation: mocks.resetComboRotation,
  resetComboScoring: mocks.resetComboScoring,
}));

import { POST } from "../../src/app/api/combos/route.js";
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
