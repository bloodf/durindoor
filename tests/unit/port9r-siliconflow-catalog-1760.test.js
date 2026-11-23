import { expect, it } from "vitest";
import siliconflow from "../../open-sse/providers/registry/siliconflow.js";

it("includes additional SiliconFlow chat models in its offline catalog", () => {
  const ids = siliconflow.models.map((model) => model.id);
  expect(ids).toEqual(expect.arrayContaining([
    "deepseek-ai/DeepSeek-V3", "Qwen/Qwen3.5-35B-A3B", "Qwen/Qwen3.5-27B", "Qwen/Qwen3.5-9B",
  ]));
  expect(new Set(ids).size).toBe(ids.length);
});
