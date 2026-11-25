import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getComboById: vi.fn(),
  getComboByName: vi.fn(),
  updateCombo: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  ...mocks,
  createCombo: vi.fn(),
  deleteCombo: vi.fn(),
  validateConnectionIds: vi.fn(),
  ComboMemberError: class extends Error {},
  ConnectionGroupValidationError: class extends Error {},
}));
vi.mock("open-sse/services/combo.js", () => ({ resetComboRotation: vi.fn(), resetComboScoring: vi.fn() }));

const { PUT } = await import("../../src/app/api/combos/[id]/route.js");

const models = ["mistral/mistral-medium-latest", "openai/gpt-5.4"];

const save = (id, body) => PUT(new Request(`http://localhost/api/combos/${id}`, {
  method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
}), { params: Promise.resolve({ id: String(id) }) });

describe("upstream PR #4716: save combo edits without changing the name", () => {
  beforeEach(() => vi.resetAllMocks());

  it.each([5, "5", "f4e0c1e7-1f41-4ab2-9f25-094c3cc145bb"])("keeps its own name when the stored id is %s", async (id) => {
    const stored = { id, name: "threads-combo", models: [...models].reverse() };
    mocks.getComboByName.mockResolvedValue(stored);
    mocks.getComboById.mockResolvedValue(stored);
    mocks.updateCombo.mockResolvedValue({ ...stored, models });

    const response = await save(id, { name: stored.name, models });

    expect(response.status).toBe(200);
    expect(mocks.updateCombo).toHaveBeenCalledWith(String(id), { name: stored.name, models });
  });

  it.each([6, "other-combo-id"])("still rejects a name owned by combo %s", async (id) => {
    mocks.getComboByName.mockResolvedValue({ id, name: "taken" });

    const response = await save(5, { name: "taken", models });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("Combo name already exists");
    expect(mocks.updateCombo).not.toHaveBeenCalled();
  });
});
