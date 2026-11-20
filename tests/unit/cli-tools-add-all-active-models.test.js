import { describe, expect, it, vi } from "vitest";
import { loadActiveCliModels } from "@/app/(dashboard)/dashboard/cli-tools/components/loadActiveCliModels.js";

describe("CLI bulk model selection", () => {
  it("uses the effective catalog including aliases, custom and no-auth models", async () => {
    const fetchModels = vi.fn().mockResolvedValue(Response.json({
      data: [
        { id: "oc/free", owned_by: "oc" },
        { id: "local/custom", owned_by: "local" },
        { id: "model-alias", owned_by: "custom" },
        { id: "oc/free", owned_by: "oc" },
        { id: "my-fallback", owned_by: "combo" },
        null,
      ]
    }));
    await expect(loadActiveCliModels(fetchModels)).resolves.toEqual(["oc/free", "local/custom", "model-alias"]);
    expect(fetchModels).toHaveBeenCalledWith("/api/v1/models", { cache: "no-store" });
  });

  it("surfaces catalog failures instead of reintroducing disabled static models", async () => {
    const fetchModels = vi.fn().mockResolvedValue(new Response(null, { status: 403 }));
    await expect(loadActiveCliModels(fetchModels)).rejects.toThrow("Could not load active models");
  });
});
