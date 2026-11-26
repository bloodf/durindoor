import { describe, expect, it } from "vitest";
import siliconflow from "../../open-sse/providers/registry/siliconflow.js";
import { FREE_MODEL_BUDGETS } from "../../open-sse/config/freeModelCatalog.data.js";

// Chat models added by upstream #1760 (head c7349d94aa0b).
const UPSTREAM_IDS = [
      "deepseek-ai/DeepSeek-V3",
      "deepseek-ai/DeepSeek-R1",
      "deepseek-ai/deepseek-vl2",
      "nex-agi/DeepSeek-V3.1-Nex-N1",
      "Qwen/Qwen3.6-35B-A3B",
      "Qwen/Qwen3.6-27B",
      "Qwen/Qwen3.5-397B-A17B",
      "Qwen/Qwen3.5-122B-A10B",
      "Qwen/Qwen3.5-35B-A3B",
      "Qwen/Qwen3.5-27B",
      "Qwen/Qwen3.5-9B",
      "Qwen/Qwen3-Next-80B-A3B-Instruct",
      "Qwen/Qwen3-Next-80B-A3B-Thinking",
      "Qwen/Qwen3-235B-A22B",
      "Qwen/Qwen3-235B-A22B-Instruct-2507",
      "Qwen/Qwen3-235B-A22B-Thinking-2507",
      "Qwen/Qwen3-32B",
      "Qwen/Qwen3-30B-A3B-Instruct-2507",
      "Qwen/Qwen3-30B-A3B-Thinking-2507",
      "Qwen/Qwen3-14B",
      "Qwen/Qwen3-8B",
      "Qwen/Qwen3-Coder-480B-A35B-Instruct",
      "Qwen/Qwen3-Coder-30B-A3B-Instruct",
      "Qwen/Qwen3-Omni-30B-A3B-Instruct",
      "Qwen/Qwen3-Omni-30B-A3B-Thinking",
      "Qwen/Qwen3-Omni-30B-A3B-Captioner",
      "Qwen/Qwen2.5-72B-Instruct",
      "Qwen/Qwen2.5-72B-Instruct-128K",
      "Qwen/Qwen2.5-32B-Instruct",
      "Qwen/Qwen2.5-14B-Instruct",
      "Qwen/Qwen2.5-7B-Instruct",
      "Qwen/Qwen2.5-VL-7B-Instruct",
      "zai-org/GLM-5.1",
      "zai-org/GLM-5",
      "zai-org/GLM-5V-Turbo",
      "zai-org/GLM-4.7",
      "zai-org/GLM-4.6",
      "zai-org/GLM-4.6V",
      "zai-org/GLM-4.5",
      "zai-org/GLM-4.5-Air",
      "zai-org/GLM-4.5V",
      "THUDM/GLM-4-32B-0414",
      "THUDM/GLM-4-9B-0414",
      "THUDM/GLM-Z1-32B-0414",
      "THUDM/GLM-Z1-9B-0414",
      "moonshotai/Kimi-K2.6",
      "moonshotai/Kimi-K2.5",
      "moonshotai/Kimi-K2-Instruct",
      "moonshotai/Kimi-K2-Instruct-0905",
      "moonshotai/Kimi-K2-Thinking",
      "openai/gpt-oss-120b",
      "openai/gpt-oss-20b",
      "baidu/ERNIE-4.5-300B-A47B",
      "tencent/Hunyuan-A13B-Instruct",
      "tencent/Hunyuan-MT-7B",
      "tencent/Hy3-preview",
      "meta-llama/Meta-Llama-3.1-8B-Instruct",
      "MiniMaxAI/MiniMax-M2.5",
      "MiniMaxAI/MiniMax-M2.1",
      "inclusionAI/Ling-flash-2.0",
      "inclusionAI/Ling-mini-2.0",
      "inclusionAI/Ring-flash-2.0",
      "google/gemma-4-31B-it",
      "google/gemma-4-26B-A4B-it",
      "ByteDance-Seed/Seed-OSS-36B-Instruct",
];

describe("upstream #1760 SiliconFlow catalog", () => {
  const ids = siliconflow.models.map((model) => model.id);

  it("includes every upstream SiliconFlow chat model in its offline catalog", () => {
    expect(UPSTREAM_IDS).toHaveLength(65);
    expect(ids).toEqual(expect.arrayContaining(UPSTREAM_IDS));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("lists every free-catalog SiliconFlow model in the provider registry", () => {
    const free = FREE_MODEL_BUDGETS.filter((entry) => entry.provider === "siliconflow");
    expect(free.length).toBeGreaterThan(0);
    for (const entry of free) expect(ids).toContain(entry.modelId);
  });
});
