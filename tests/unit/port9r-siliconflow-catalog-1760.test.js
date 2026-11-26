import { describe, expect, it } from "vitest";
import siliconflow from "../../open-sse/providers/registry/siliconflow.js";

describe("upstream #1760 SiliconFlow catalog", () => {
  it("includes additional SiliconFlow chat models in its offline catalog", () => {
    const ids = siliconflow.models.map((model) => model.id);
    expect(ids).toEqual(expect.arrayContaining([
      "deepseek-ai/DeepSeek-V3", "Qwen/Qwen3.5-35B-A3B", "Qwen/Qwen3.5-27B", "Qwen/Qwen3.5-9B",
      "nex-agi/DeepSeek-V3.1-Nex-N1", "Qwen/Qwen3-Next-80B-A3B-Instruct",
      "Qwen/Qwen3-Next-80B-A3B-Thinking", "Qwen/Qwen3-235B-A22B-Instruct-2507",
      "Qwen/Qwen3-235B-A22B-Thinking-2507",
    ]));
    expect(new Set(ids).size).toBe(ids.length);
  });
});
