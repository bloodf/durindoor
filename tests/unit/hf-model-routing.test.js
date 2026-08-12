import { describe, it, expect } from "vitest";
import { parseModel } from "../../open-sse/services/model.js";
import huggingface from "../../open-sse/providers/registry/huggingface.js";

describe("HuggingFace model alias parsing", () => {
  it("resolves hf alias to huggingface provider", () => {
    expect(parseModel("hf/black-forest-labs/FLUX.1-schnell")).toMatchObject({
      provider: "huggingface",
      model: "black-forest-labs/FLUX.1-schnell",
      providerAlias: "hf",
    });
  });
});

describe("HuggingFace STT dispatch", () => {
  it("exposes a dispatchable sttConfig", () => {
    expect(huggingface.sttConfig).toEqual({
      baseUrl: "https://api-inference.huggingface.co/models",
      authType: "apikey",
      authHeader: "bearer",
      format: "huggingface-asr",
    });
  });
});
