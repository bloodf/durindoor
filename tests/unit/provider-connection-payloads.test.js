import { describe, expect, it } from "vitest";
import { normalizeProviderSpecificData } from "../../src/lib/providerNormalization.js";
import { buildBulkProviderConnectionPayload } from "../../src/shared/utils/providerConnectionPayloads.js";

describe("dashboard provider connection payloads", () => {
  it("includes shared Azure OpenAI metadata for bulk-added keys", () => {
    const payload = buildBulkProviderConnectionPayload({
      provider: "azure-openai",
      apiKey: "sk-azure",
      name: "Azure Key 1",
      providerSpecificData: {
        baseUrl: "https://resource.openai.azure.com",
        deployment: "gpt-4o",
        apiVersion: "2024-12-01-preview",
      },
    });

    expect(payload).toMatchObject({
      provider: "azure-openai",
      apiKey: "sk-azure",
      name: "Azure Key 1",
      priority: 1,
      testStatus: "unknown",
      providerSpecificData: {
        baseUrl: "https://resource.openai.azure.com",
        deployment: "gpt-4o",
        apiVersion: "2024-12-01-preview",
      },
    });
  });

  it("includes shared endpoint metadata for bulk-added cloud keys", () => {
    const payload = buildBulkProviderConnectionPayload({
      provider: "sap",
      apiKey: "sk-sap",
      name: "SAP Key 1",
      providerSpecificData: { baseUrl: "https://sap.example.com/v2/lm/deployments/deployment-id" },
    });

    expect(payload).toEqual({
      provider: "sap",
      apiKey: "sk-sap",
      name: "SAP Key 1",
      priority: 1,
      testStatus: "unknown",
      providerSpecificData: { baseUrl: "https://sap.example.com/v2/lm/deployments/deployment-id" },
    });
  });

  it("normalizes Azure AI and SAP endpoint metadata", () => {
    expect(normalizeProviderSpecificData("azure-ai", { azureEndpoint: "https://foundry.example.com/" })).toEqual({
      baseUrl: "https://foundry.example.com",
    });
    expect(normalizeProviderSpecificData("sap", { deploymentUrl: "https://sap.example.com/v2/lm/deployments/id/" })).toEqual({
      baseUrl: "https://sap.example.com/v2/lm/deployments/id",
    });
  });
});
