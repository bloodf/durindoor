import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createCombo: vi.fn(),
  updateCombo: vi.fn(),
  deleteCombo: vi.fn(),
  getComboById: vi.fn(),
  getComboByName: vi.fn(),
  validateConnectionIds: vi.fn(async (ids) => ids),
  resetComboRotation: vi.fn(),
  resetComboScoring: vi.fn(),
  normalizeComboCapabilities: vi.fn(() => ({ ok: true, capabilities: null })),
}));

class ComboMemberError extends Error {}
class ConnectionGroupValidationError extends Error {}

vi.mock("@/lib/localDb", () => ({
  createCombo: mocks.createCombo,
  updateCombo: mocks.updateCombo,
  deleteCombo: mocks.deleteCombo,
  getComboById: mocks.getComboById,
  getComboByName: mocks.getComboByName,
  validateConnectionIds: mocks.validateConnectionIds,
  ComboMemberError,
  ConnectionGroupValidationError,
}));

vi.mock("open-sse/services/combo.js", () => ({
  resetComboRotation: mocks.resetComboRotation,
  resetComboScoring: mocks.resetComboScoring,
}));

vi.mock("open-sse/providers/capabilities.js", () => ({
  normalizeComboCapabilities: mocks.normalizeComboCapabilities,
}));

const {
  ComboManagementError,
  createComboManaged,
  updateComboManaged,
  deleteComboManaged,
} = await import("../../src/lib/combos/comboManagement.js");

describe("combo management", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateConnectionIds.mockImplementation(async (ids) => ids);
    mocks.normalizeComboCapabilities.mockReturnValue({ ok: true, capabilities: null });
    mocks.getComboByName.mockResolvedValue(null);
  });

  it("creates a combo with defaults applied", async () => {
    mocks.createCombo.mockResolvedValue({ id: "cb1", name: "fast" });

    const combo = await createComboManaged({ name: "fast" });

    expect(mocks.createCombo).toHaveBeenCalledWith({
      name: "fast",
      models: [],
      members: undefined,
      kind: null,
      capabilities: null,
      allowedConnectionIds: undefined,
    });
    expect(combo.id).toBe("cb1");
  });

  it("requires a name", async () => {
    await expect(createComboManaged({})).rejects.toMatchObject({
      message: "Name is required",
      status: 400,
    });
    expect(mocks.createCombo).not.toHaveBeenCalled();
  });

  it("rejects a name outside the allowed character set", async () => {
    await expect(createComboManaged({ name: "bad name!" })).rejects.toBeInstanceOf(ComboManagementError);
    expect(mocks.createCombo).not.toHaveBeenCalled();
  });

  it("accepts dots, dashes and underscores in a name", async () => {
    mocks.createCombo.mockResolvedValue({ id: "cb1", name: "fast-2.0_x" });
    await expect(createComboManaged({ name: "fast-2.0_x" })).resolves.toMatchObject({ id: "cb1" });
  });

  it("rejects a duplicate name on create", async () => {
    mocks.getComboByName.mockResolvedValue({ id: "other", name: "fast" });

    await expect(createComboManaged({ name: "fast" })).rejects.toMatchObject({
      message: "Combo name already exists",
      status: 400,
    });
  });

  it("rejects an oversized connection allowlist", async () => {
    const ids = Array.from({ length: 501 }, (_, i) => `c${i}`);

    await expect(createComboManaged({ name: "fast", allowedConnectionIds: ids }))
      .rejects.toThrow(/at most 500 ids/);
    expect(mocks.validateConnectionIds).not.toHaveBeenCalled();
  });

  it("surfaces a capability normalization failure as a 400", async () => {
    mocks.normalizeComboCapabilities.mockReturnValue({ ok: false, error: "capabilities must be an object or null" });

    await expect(createComboManaged({ name: "fast", capabilities: 7 })).rejects.toMatchObject({
      message: "capabilities must be an object or null",
      status: 400,
    });
  });

  it("maps a member validation error to a 400", async () => {
    mocks.createCombo.mockRejectedValue(new ComboMemberError("member connection not found"));

    await expect(createComboManaged({ name: "fast" })).rejects.toMatchObject({
      message: "member connection not found",
      status: 400,
    });
  });

  it("lets its own name pass the duplicate check on update", async () => {
    mocks.getComboByName.mockResolvedValue({ id: "cb1", name: "fast" });
    mocks.getComboById.mockResolvedValue({ id: "cb1", name: "fast" });
    mocks.updateCombo.mockResolvedValue({ id: "cb1", name: "fast" });

    await expect(updateComboManaged("cb1", { name: "fast" })).resolves.toMatchObject({ id: "cb1" });
  });

  it("rejects a rename onto another combo's name", async () => {
    mocks.getComboByName.mockResolvedValue({ id: "cb2", name: "slow" });

    await expect(updateComboManaged("cb1", { name: "slow" })).rejects.toMatchObject({
      message: "Combo name already exists",
      status: 400,
    });
    expect(mocks.updateCombo).not.toHaveBeenCalled();
  });

  it("resets rotation for both the old and the new name on rename", async () => {
    mocks.getComboById.mockResolvedValue({ id: "cb1", name: "fast" });
    mocks.updateCombo.mockResolvedValue({ id: "cb1", name: "slow" });

    await updateComboManaged("cb1", { name: "slow" });

    expect(mocks.resetComboRotation).toHaveBeenCalledWith("fast");
    expect(mocks.resetComboRotation).toHaveBeenCalledWith("slow");
    expect(mocks.resetComboScoring).toHaveBeenCalledWith("fast");
    expect(mocks.resetComboScoring).toHaveBeenCalledWith("slow");
  });

  it("resets rotation once when the name is unchanged", async () => {
    mocks.getComboById.mockResolvedValue({ id: "cb1", name: "fast" });
    mocks.updateCombo.mockResolvedValue({ id: "cb1", name: "fast" });

    await updateComboManaged("cb1", { models: ["openai/gpt-4"] });

    expect(mocks.resetComboRotation).toHaveBeenCalledTimes(1);
    expect(mocks.resetComboRotation).toHaveBeenCalledWith("fast");
  });

  it("clears the allowlist only when explicitly provided", async () => {
    mocks.getComboById.mockResolvedValue({ id: "cb1", name: "fast" });
    mocks.updateCombo.mockResolvedValue({ id: "cb1", name: "fast" });

    await updateComboManaged("cb1", { models: [] });
    expect(mocks.updateCombo).toHaveBeenCalledWith("cb1", { models: [] });

    await updateComboManaged("cb1", { allowedConnectionIds: [] });
    expect(mocks.updateCombo).toHaveBeenLastCalledWith("cb1", { allowedConnectionIds: [] });
  });

  it("reports a missing combo on update as 404", async () => {
    mocks.getComboById.mockResolvedValue(null);
    mocks.updateCombo.mockResolvedValue(null);

    await expect(updateComboManaged("gone", { models: [] })).rejects.toMatchObject({
      message: "Combo not found",
      status: 404,
    });
    expect(mocks.resetComboRotation).not.toHaveBeenCalled();
  });

  it("deletes a combo and invalidates its rotation state", async () => {
    mocks.getComboById.mockResolvedValue({ id: "cb1", name: "fast" });
    mocks.deleteCombo.mockResolvedValue(true);

    await expect(deleteComboManaged("cb1")).resolves.toEqual({ success: true });
    expect(mocks.resetComboRotation).toHaveBeenCalledWith("fast");
    expect(mocks.resetComboScoring).toHaveBeenCalledWith("fast");
  });

  it("reports a missing combo on delete as 404", async () => {
    mocks.getComboById.mockResolvedValue(null);
    mocks.deleteCombo.mockResolvedValue(false);

    await expect(deleteComboManaged("gone")).rejects.toMatchObject({
      message: "Combo not found",
      status: 404,
    });
    expect(mocks.resetComboRotation).not.toHaveBeenCalled();
  });
});
