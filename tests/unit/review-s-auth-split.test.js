import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const authPath = fileURLToPath(new URL("../../src/sse/services/auth.js", import.meta.url));
const expectedExports = [
  "clearAccountError",
  "evaluateApiKeyAuth",
  "extractApiKey",
  "extractApiKeyCandidates",
  "getNoAuthProviderCredentials",
  "getProviderCredentials",
  "getProviderCredentialsWithQuotaPreflight",
  "hasValidCliToken",
  "isProviderConnectionModelLocked",
  "isValidApiKey",
  "markAccountUnavailable",
  "normalizeOllamaModelId",
  "ollamaCatalogServesModel",
  "projectProviderCredentials",
  "providerAllowsPublicNoAuthFallback",
  "rankOllamaConnectionsByCatalog",
  "resetProviderSessionAffinity",
  "resolveClientApiKey"
];

describe("auth service split contract", () => {
  it("preserves the auth.js export names", async () => {
    const auth = await import("../../src/sse/services/auth.js");
    expect(Object.keys(auth).sort()).toEqual([...expectedExports].sort());
  });

  it("keeps auth.js under the line budget", async () => {
    const source = await readFile(authPath, "utf8");
    expect(source.split("\n").length - 1).toBeLessThan(1000);
  });
});
