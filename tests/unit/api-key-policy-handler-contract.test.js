import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");
const authHandlers = [
  "chat.js",
  "countTokens.js",
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
const policyHandlers = authHandlers.filter((file) => !["chat.js", "countTokens.js"].includes(file));

describe("non-chat API-key policy contract", () => {
  it.each(authHandlers)("%s authenticates before model, executor, or provider work", (file) => {
    const source = fs.readFileSync(path.join(repoRoot, "src/sse/handlers", file), "utf8");
    const guard = source.indexOf("await resolveClientApiKey(");
    expect(guard, `${file} must use the shared credential resolver`).toBeGreaterThan(-1);

    for (const work of ["await getModelInfo(", "getExecutor(", "await getProviderCredentials("]) {
      const position = source.indexOf(work);
      if (position >= 0) {
        expect(guard, `${file} must authenticate before ${work}`).toBeLessThan(position);
      }
    }
  });

  it.each(policyHandlers)("%s checks the resolved target and accounts only successful responses", (file) => {
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

  it("guards native Gemini provider work with the same credential evaluator", () => {
    const source = fs.readFileSync(
      path.join(repoRoot, "src/app/api/v1beta/models/[...path]/route.js"),
      "utf8",
    );
    const guard = source.indexOf("await resolveClientApiKey(");
    const providerWork = source.indexOf("await getProviderCredentials(");
    expect(guard).toBeGreaterThan(-1);
    expect(providerWork).toBeGreaterThan(guard);
  });
});
