import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = fileURLToPath(new URL(".", import.meta.url));

const cases = [
  {
    executor: "huggingchat.js",
    registryVar: "huggingchatRegistry",
    registryPath: "../providers/registry/huggingchat.js",
    modelId: "baidu/ERNIE-4.5-VL-424B-A47B-Base-PT",
  },
  {
    executor: "yuanbao-web.js",
    registryVar: "yuanbaoWebRegistry",
    registryPath: "../providers/registry/yuanbao-web.js",
    modelId: "deepseek-v3",
  },
  {
    executor: "zenmux-free.js",
    registryVar: "zenmuxFreeRegistry",
    registryPath: "../providers/registry/zenmux-free.js",
    modelId: "deepseek/deepseek-chat",
  },
  {
    executor: "inner-ai.js",
    registryVar: "innerAiRegistry",
    registryPath: "../providers/registry/inner-ai.js",
    modelId: "gpt-4o",
  },
];

function readExecutor(name) {
  return readFileSync(new URL(`../../open-sse/executors/${name}`, `file://${here}`), "utf8");
}

describe("executor DEFAULT_MODEL sources (audit R5)", () => {
  for (const { executor, registryVar, registryPath, modelId } of cases) {
    describe(executor, () => {
      const source = readExecutor(executor);

      it("imports the provider registry", () => {
        const importRe = new RegExp(
          String.raw`import\s+${registryVar}\s+from\s+["']${registryPath.replace(/[.]/g, "\\.")}["'];`,
        );
        expect(source, `${executor} must import ${registryVar}`).toMatch(importRe);
      });

      it("declares DEFAULT_MODEL from the registry with the original literal as fallback", () => {
        const declRe = new RegExp(
          String.raw`const\s+DEFAULT_MODEL\s*=\s*${registryVar}\.models\?\.\[0\]\?\.id\s*\|\|\s*["']${modelId.replace(/[/]/g, "\\/")}["']\s*;`,
        );
        expect(
          source,
          `${executor} DEFAULT_MODEL must be \`${registryVar}.models?.[0]?.id || "${modelId}"\``,
        ).toMatch(declRe);
      });

      it("uses the model-id literal only as the DEFAULT_MODEL fallback (not as a hard-coded value)", () => {
        const escapedModelId = modelId.replace(/[/]/g, "\\/");
        const occurrences = source.split("\n").filter((line) => line.includes(`"${modelId}"`));
        expect(
          occurrences.length,
          `${executor} must reference "${modelId}" at least once (the DEFAULT_MODEL fallback)`,
        ).toBeGreaterThanOrEqual(1);
        // Every quoted occurrence must be one of:
        //   (a) the DEFAULT_MODEL `|| "<model>"` fallback, or
        //   (b) a string-literal key in an object literal (e.g. MODEL_MAP) — not a default.
        for (const line of occurrences) {
          const isFallback = new RegExp(String.raw`\|\|\s*["']${escapedModelId}["']`).test(line);
          const isObjectKey = new RegExp(String.raw`["']${escapedModelId}["']\s*:`).test(line);
          expect(
            isFallback || isObjectKey,
            `${executor} references "${modelId}" in a non-fallback, non-object-key position: ${line.trim()}`,
          ).toBe(true);
        }
      });
    });
  }
});
