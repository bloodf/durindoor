import { describe, expect, it, vi } from "vitest";

async function loadFormBehavior() {
  return import("@/app/(dashboard)/dashboard/providers/[id]/addApiKeyForm.js").catch(() => ({}));
}

describe("AddApiKeyModal Account ID behavior", () => {
  it.each(["snowflake", "cloudflare-ai"])("requires a trimmed non-empty Account ID for %s", async (provider) => {
    const { buildAccountIdProviderData } = await loadFormBehavior();

    expect(typeof buildAccountIdProviderData).toBe("function");
    expect(buildAccountIdProviderData(provider, "   ")).toBeNull();
    expect(buildAccountIdProviderData(provider, "  org-account  ")).toEqual({ accountId: "org-account" });
  });

  it.each(["snowflake", "cloudflare-ai"])("does not save %s credentials after validation fails", async (provider) => {
    const { validateAndSaveProviderConnection } = await loadFormBehavior();
    const onSave = vi.fn();
    const fetchImpl = vi.fn().mockResolvedValue({ json: async () => ({ valid: false }) });

    expect(typeof validateAndSaveProviderConnection).toBe("function");
    const saved = await validateAndSaveProviderConnection({
      provider,
      apiKey: "secret",
      providerSpecificData: { accountId: "  org-account  " },
      connection: { name: "Production", testStatus: "active" },
      onSave,
      fetchImpl,
    });

    expect(saved).toBe(false);
    expect(onSave).not.toHaveBeenCalled();
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toMatchObject({
      provider,
      providerSpecificData: { accountId: "org-account" },
    });
  });

  it("preserves unknown-status saves for non-Account-ID providers when validation is unavailable", async () => {
    const { validateAndSaveProviderConnection } = await loadFormBehavior();
    const onSave = vi.fn();
    const fetchImpl = vi.fn().mockRejectedValue(new Error("offline"));

    const isValid = await validateAndSaveProviderConnection({
      provider: "openai",
      apiKey: "secret",
      connection: { name: "Offline key", testStatus: "active" },
      onSave,
      fetchImpl,
    });

    expect(isValid).toBe(false);
    expect(onSave).toHaveBeenCalledWith({
      name: "Offline key",
      testStatus: "unknown",
      providerSpecificData: undefined,
    });
  });
});
