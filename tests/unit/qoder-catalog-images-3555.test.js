import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getQoderModelConfig: vi.fn(),
  resolveQoderModels: vi.fn(),
}));

vi.mock("../../open-sse/services/qoderModels.js", () => mocks);

import qoder from "../../open-sse/providers/registry/qoder.js";
import { getCapabilitiesForModel, resolveModelLimits } from "../../open-sse/providers/capabilities.js";
import { QODER_MODEL_MAP } from "../../open-sse/shared/qoder/constants.js";
import { __test__ as qoderExecutorInternals } from "../../open-sse/executors/qoder.js";

const modelConfig = {
  key: "qmodel_38max",
  is_reasoning: true,
  max_output_tokens: 65536,
};

beforeEach(() => {
  mocks.getQoderModelConfig.mockReset().mockResolvedValue(modelConfig);
  mocks.resolveQoderModels.mockReset();
});

describe("Qoder catalog refresh (decolua/9router#3555)", () => {
  it("exposes current Qwen and GLM IDs in the registry and identity map", () => {
    expect(qoder.models).toEqual(expect.arrayContaining([
      { id: "lite", name: "Lite" },
      { id: "qmodel_38max", name: "Qwen3.8-Max" },
      { id: "gmodel", name: "GLM-5.3" },
    ]));
    expect(qoder.models.some(({ id }) => id === "qmodel_preview" || id === "gm51model")).toBe(false);
    expect(QODER_MODEL_MAP).toMatchObject({
      lite: "lite",
      qmodel_38max: "qmodel_38max",
      gmodel: "gmodel",
    });
    expect(QODER_MODEL_MAP).not.toHaveProperty("gm51model");
  });

  it("maps opaque raw Qoder IDs to model capabilities", () => {
    expect(getCapabilitiesForModel("qoder", "qmodel_38max")).toMatchObject({
      vision: true,
      reasoning: true,
      thinkingFormat: "qwen",
      thinkingCanDisable: false,
      contextWindow: 1000000,
      maxOutput: 65536,
    });
    expect(getCapabilitiesForModel("qoder", "gmodel")).toMatchObject({
      vision: false,
      reasoning: true,
      thinkingFormat: "zai",
      thinkingCanDisable: false,
      contextWindow: 1000000,
      maxOutput: 131072,
    });
    expect(getCapabilitiesForModel("qoder", "kmodel_latest")).toMatchObject({
      vision: true,
      reasoning: true,
      thinkingFormat: "kimi",
      thinkingCanDisable: false,
      contextWindow: 1048576,
      maxOutput: 262144,
    });
    expect(getCapabilitiesForModel("qoder", "mmodel")).toMatchObject({
      vision: false,
      reasoning: true,
      thinkingFormat: "minimax",
      thinkingCanDisable: false,
      contextWindow: 1000000,
      maxOutput: 131072,
    });
    expect(resolveModelLimits("qoder", "kmodel")).toMatchObject({
      contextWindow: 262144,
      maxOutput: undefined,
      known: true,
      source: "provider",
    });
  });
});

describe("Qoder image pass-through (decolua/9router#3555)", () => {
  it("keeps OpenAI and Claude images in outgoing payload.messages", async () => {
    const { payload } = await qoderExecutorInternals.buildQoderRequestBody({
      model: "qoder/qmodel_38max",
      body: {
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "remote" },
              { type: "image_url", image_url: { url: "https://example.com/a.png" } },
            ],
          },
          {
            role: "user",
            content: [
              { type: "text", text: "inline" },
              { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "AAAA" } },
            ],
          },
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgo=" } },
              { type: "text", text: "data URI" },
            ],
          },
        ],
      },
      credentials: { providerSpecificData: { userId: "user-id" } },
    });

    expect(payload.messages[0].content).toEqual([
      { type: "text", text: "remote" },
      { type: "image_url", image_url: { url: "https://example.com/a.png" } },
    ]);
    expect(payload.messages[1].content).toEqual([
      { type: "text", text: "inline" },
      { type: "image_url", image_url: { url: "data:image/jpeg;base64,AAAA" } },
    ]);
    expect(payload.messages[2].content).toEqual([
      { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgo=" } },
      { type: "text", text: "data URI" },
    ]);
  });

  it("drops unusable image blocks without dropping text", () => {
    const { messages } = qoderExecutorInternals.normalizeMessages([{
      role: "user",
      content: [
        { type: "text", text: "keep me" },
        { type: "image_url", image_url: {} },
        { type: "image", source: { type: "base64" } },
      ],
    }]);

    expect(messages[0].content).toBe("keep me");
  });

  it("includes image references in chat record identity", async () => {
    const build = (url) => qoderExecutorInternals.buildQoderRequestBody({
      model: "qoder/qmodel_38max",
      body: {
        messages: [{
          role: "user",
          content: [
            { type: "text", text: "same prompt" },
            { type: "image_url", image_url: { url } },
          ],
        }],
      },
      credentials: { providerSpecificData: { userId: "user-id" } },
    });

    const first = await build("https://example.com/first.png");
    const second = await build("https://example.com/second.png");
    expect(first.payload.chat_record_id).not.toBe(second.payload.chat_record_id);
  });
});
