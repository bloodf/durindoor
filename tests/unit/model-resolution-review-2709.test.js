import { beforeEach, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ custom: vi.fn(), aliases: vi.fn(), policy: null }));
vi.mock("@/lib/localDb", async (original) => ({
  ...(await original()),
  getComboForModel: async () => null,
  getModelAliases: db.aliases,
  getCustomModels: db.custom,
  getProviderNodes: async () => [],
  getProviderConnections: async () => [],
  getApiKeyByKey: async () => ({ isActive: true, policy: db.policy }),
}));
vi.mock("@/sse/services/auth.js", async (original) => ({
  ...(await original()), hasValidCliToken: async () => false,
}));

import { getModelInfo, loadCustomCapabilities } from "@/sse/services/model.js";
import { resolveModel } from "@/sse/handlers/chat/singleModel/resolveModel.js";
import { LOCAL_POLICY_REJECTION, LOCAL_REQUEST_ERROR } from "open-sse/services/combo.js";

beforeEach(() => {
  db.custom.mockReset().mockResolvedValue([]);
  db.aliases.mockReset().mockResolvedValue({});
  db.policy = null;
});

it.each(["dall-e-3", "whisper-1", "tts-1"])("preserves shared media passthrough for %s", async (model) => {
  expect(await getModelInfo(model)).toEqual({ provider: "openai", model });
});

it("keeps inference rejection opt-in and preserves qualified raw identities", async () => {
  expect(await getModelInfo("genuineunknown", { rejectUnknownBare: true })).toEqual({
    provider: null, model: "genuineunknown", errorType: "model_not_found",
  });
  expect(await getModelInfo("openai/raw:custom:id", { rejectUnknownBare: true })).toEqual({
    provider: "openai", model: "raw:custom:id",
  });
});

it.each([false, true])("checks policy before revealing custom ambiguity (composite=%s)", async (composite) => {
  db.custom.mockResolvedValue([
    { providerAlias: "openai", id: "private-shared" },
    { providerAlias: "xai", id: "private-shared" },
  ]);
  db.policy = { allowedModels: ["openai/gpt-4o"] };
  const dispatch = vi.fn();
  const result = await resolveModel({
    modelStr: "private-shared", request: new Request("https://offline.test/v1/chat/completions"),
    apiKey: "synthetic", dispatchNestedCombo: dispatch, reportComboPolicyRejections: composite,
  });
  expect(result.response.status).toBe(403);
  expect((await result.response.json()).error.message).toBe(composite ? "Access denied" : "Model \"private-shared\" is not allowed for this API key");
  if (composite) expect(result.response[LOCAL_POLICY_REJECTION]).toBe(true);
  expect(dispatch).not.toHaveBeenCalled();
});

it("retains unrestricted ambiguity and never dispatches it", async () => {
  db.custom.mockResolvedValue([{ providerAlias: "openai", id: "shared" }, { providerAlias: "xai", id: "shared" }]);
  const dispatch = vi.fn();
  const result = await resolveModel({ modelStr: "shared", request: new Request("https://offline.test"), apiKey: null, dispatchNestedCombo: dispatch });
  expect(result.response.status).toBe(400);
  expect((await result.response.json()).error.message).toBe("Model 'shared' is ambiguous. Use provider/model prefix.");
  expect(dispatch).not.toHaveBeenCalled();
});

it("fails open only for optional custom metadata while retaining unknown404", async () => {
  db.custom.mockRejectedValue(new Error("optional metadata unavailable"));
  expect(await loadCustomCapabilities("openai", "gpt-4o", "openai")).toBeNull();
  expect(await getModelInfo("custommodel", { rejectUnknownBare: true })).toEqual({ provider: null, model: "custommodel", errorType: "model_not_found" });
  const result = await resolveModel({ modelStr: "custommodel", request: new Request("https://offline.test"), apiKey: null });
  expect(result.response.status).toBe(404);
  expect(result.response[LOCAL_REQUEST_ERROR]).toBe(true);
  expect((await result.response.json()).error.message).toBe("Model 'custommodel' could not be resolved to a known provider.");
});

it("does not swallow routing alias store failures", async () => {
  db.aliases.mockRejectedValue(new Error("routing store unavailable"));
  await expect(getModelInfo("custommodel", { rejectUnknownBare: true })).rejects.toThrow("routing store unavailable");
});
