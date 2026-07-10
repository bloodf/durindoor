import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");
const handlers = [
  "embeddings.js",
  "imageGeneration.js",
  "imageEdit.js",
  "tts.js",
  "stt.js",
  "search.js",
  "fetch.js",
  "moderations.js",
  "rerank.js",
  "music.js",
  "video.js",
];

describe("non-chat API-key policy contract", () => {
  it.each(handlers)("%s checks the resolved target and accounts only successful responses", (file) => {
    const source = fs.readFileSync(path.join(repoRoot, "src/sse/handlers", file), "utf8");
    const policyChecks = source.match(/enforceApiKeyModelPolicy\(/g) || [];

    expect(policyChecks.length, `${file} must authorize the resolved target exactly once`).toBe(1);
    expect(source).toContain("recordApiKeyUsageForResponse");
    expect(source).not.toMatch(/\brecordApiKeyUsage\(/);
  });

  it("countTokens authorizes its canonical provider target without consuming generation usage", () => {
    const source = fs.readFileSync(path.join(repoRoot, "src/sse/handlers/countTokens.js"), "utf8");
    expect(source.match(/enforceApiKeyModelPolicy\(/g)).toHaveLength(1);
    expect(source).not.toContain("recordApiKeyUsageForResponse");
  });
});
