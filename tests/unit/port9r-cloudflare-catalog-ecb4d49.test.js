import { expect, it } from "vitest";
import cloudflare from "../../open-sse/providers/registry/cloudflare-ai.js";

it("lists the upstream active replacements and omits retired models", () => {
  const ids = cloudflare.models.map(({ id }) => id);
  for (const id of ["@cf/deepseek-ai/deepseek-r1-distill-qwen-32b", "@cf/moonshotai/kimi-k2.6", "@cf/qwen/qwq-32b", "@cf/meta/llama-3.2-1b-instruct"]) expect(ids).not.toContain(id);
  for (const id of ["@cf/meta/llama-4-scout-17b-16e-instruct", "@cf/deepseek-ai/deepseek-v4.1-flash-1017", "@cf/google/gemma-4-26b-a4b-it", "@cf/zai-org/glm-5.3", "@cf/openai/gpt-oss-120b", "@cf/openai/gpt-oss-20b", "@cf/qwen/qwen3.8-27b"]) expect(ids).toContain(id);
});
