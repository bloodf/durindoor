import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  extractApiKey: vi.fn(),
  getApiKeyByKey: vi.fn(),
  getSettings: vi.fn(),
  hasValidCliToken: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getApiKeyByKey: mocks.getApiKeyByKey,
  getSettings: mocks.getSettings,
}));
vi.mock("@/sse/services/auth.js", () => ({
  extractApiKey: mocks.extractApiKey,
  hasValidCliToken: mocks.hasValidCliToken,
}));

const { resolveResourceOwner } = await import("@/sse/services/resourceOwnership.js");

describe("Files/Batches resource ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasValidCliToken.mockResolvedValue(false);
    mocks.getSettings.mockResolvedValue({ requireApiKey: false });
    mocks.extractApiKey.mockReturnValue(null);
  });

  it("uses a distinct global operator identity for a valid CLI token", async () => {
    mocks.hasValidCliToken.mockResolvedValueOnce(true);
    await expect(resolveResourceOwner({})).resolves.toEqual({
      authorized: true,
      ownerId: "operator",
      allowAllOwners: true,
    });
    expect(mocks.getApiKeyByKey).not.toHaveBeenCalled();
  });

  it("allows local and placeholder callers only while key enforcement is disabled", async () => {
    await expect(resolveResourceOwner({})).resolves.toMatchObject({ authorized: true, ownerId: "local" });

    mocks.extractApiKey.mockReturnValue("sk_durindoor");
    mocks.getApiKeyByKey.mockResolvedValue(null);
    await expect(resolveResourceOwner({})).resolves.toMatchObject({ authorized: true, ownerId: "local" });

    mocks.getSettings.mockResolvedValue({ requireApiKey: true });
    await expect(resolveResourceOwner({})).resolves.toMatchObject({ authorized: false });
  });

  it("uses stable stored-key IDs and rejects inactive or expired records", async () => {
    mocks.extractApiKey.mockReturnValue("sk-stored");
    mocks.getApiKeyByKey.mockResolvedValueOnce({ id: "key-a", isActive: true, expiresAt: null });
    await expect(resolveResourceOwner({})).resolves.toMatchObject({ authorized: true, ownerId: "key-a", allowAllOwners: false });

    mocks.getApiKeyByKey.mockResolvedValueOnce({ id: "key-a", isActive: false, expiresAt: null });
    await expect(resolveResourceOwner({})).resolves.toMatchObject({ authorized: false });

    mocks.getApiKeyByKey.mockResolvedValueOnce({ id: "key-a", isActive: true, expiresAt: "2000-01-01T00:00:00.000Z" });
    await expect(resolveResourceOwner({})).resolves.toMatchObject({ authorized: false });
  });
});
