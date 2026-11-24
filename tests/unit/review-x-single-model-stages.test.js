import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Issue 2434 part 3: handleSingleModelChat is a thin adapter over named stage
// modules under src/sse/handlers/chat/singleModel/, driven by one context object.
const chatDir = join(import.meta.dirname, "../../src/sse/handlers/chat");
const stageDir = join(chatDir, "singleModel");
const read = (path) => readFileSync(path, "utf8");

const STAGES = [
  { file: "context.js", exports: ["createSingleModelContext", "createLoopState"] },
  { file: "resolveModel.js", exports: ["resolveModel", "isImageOnlyModel", "isNonChatModel"] },
  { file: "admission.js", exports: ["admitRequest"] },
  { file: "credentials.js", exports: ["selectCredentials", "prepareAttempt"] },
  { file: "dispatch.js", exports: ["dispatchAttempt"] },
  { file: "postProcess.js", exports: ["processAttemptResult", "holdForEarlyEof"] },
  { file: "providerHooks.js", exports: ["dispatchChatgptPlan", "warmRequestModelLimits", "evaluateProviderFailure", "__resetAntigravity429StrikesForTests"] },
];

describe("single-model chat stages", () => {
  const adapter = read(join(chatDir, "singleModel.js"));

  it("keeps singleModel.js under 400 lines", () => {
    expect(adapter.split("\n").length).toBeLessThan(400);
  });

  it.each(STAGES)("$file exists and exports its stage functions", ({ file, exports }) => {
    const path = join(stageDir, file);
    expect(existsSync(path)).toBe(true);
    const source = read(path);
    for (const name of exports) expect(source).toMatch(new RegExp(`export (?:async )?function ${name}\\b`));
  });

  it("calls every stage from singleModel.js through one context object", () => {
    for (const stage of ["resolveModel", "admitRequest", "dispatchChatgptPlan", "selectCredentials", "prepareAttempt", "dispatchAttempt", "processAttemptResult"]) {
      expect(adapter).toMatch(new RegExp(`\\b${stage}\\(ctx`));
    }
    for (const file of ["context", "resolveModel", "admission", "credentials", "dispatch", "postProcess", "providerHooks"]) {
      expect(adapter).toContain(`./singleModel/${file}.js`);
    }
    expect(adapter).toMatch(/export async function handleSingleModelChat\(body, modelStr, clientRawRequest = null, request = null, apiKey = null, attemptSignal = null, tokenSaverCollector = null, options = \{\}\)/);
    expect(adapter).toContain("createSingleModelContext({");
  });

  it("keeps provider-specific branches out of singleModel.js and in providerHooks.js", () => {
    expect(adapter.replace(/^export \{.*\n/gm, "")).not.toMatch(/antigravity|\bagy\b|KIMI_|chatgpt-plan|enforceCursorCapabilities/i);
    const hooks = read(join(stageDir, "providerHooks.js"));
    for (const marker of ["recordAntigravity429Strike", "KIMI_CODING_MODELS_URL", "resolveChatgptPlanDispatch", "enforceCursorCapabilities"]) {
      expect(hooks).toContain(marker);
    }
  });

  it("keeps the public re-exports used by chat.js", async () => {
    const mod = await import("../../src/sse/handlers/chat/singleModel.js");
    for (const name of ["handleSingleModelChat", "__resetAntigravity429StrikesForTests", "warmRequestModelLimits", "isImageOnlyModel", "isNonChatModel", "holdForEarlyEof"]) {
      expect(mod[name]).toBeTypeOf("function");
    }
  });
});
