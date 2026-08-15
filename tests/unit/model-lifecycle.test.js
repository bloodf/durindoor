import { describe, expect, it, vi } from "vitest";
import {
  MODEL_LIFECYCLE_RECORDS,
  formatModelLifecycleMessage,
  getModelLifecycleDecision,
} from "../../open-sse/services/modelLifecycle.js";
import { checkModelLifecycle } from "../../open-sse/handlers/chatCore/modelLifecyclePolicy.js";

const CURRENT_DATE = new Date("2026-07-26T00:00:00.000Z");

describe("model lifecycle", () => {
  it("rejects shutdown OpenAI models with replacement guidance without rewriting", () => {
    const decision = getModelLifecycleDecision("openai", "gpt-5.2-codex", CURRENT_DATE);

    expect(decision).toMatchObject({
      status: "shutdown",
      action: "reject",
      model: "gpt-5.2-codex",
      replacement: { provider: "openai", model: "gpt-5.6-sol" },
    });
    expect(formatModelLifecycleMessage(decision)).toMatch(/cannot be routed automatically/);
  });

  it("warns for upcoming shutdowns and keeps provider scope", () => {
    expect(getModelLifecycleDecision("openai", "gpt-5.3-chat-latest", CURRENT_DATE)).toMatchObject({
      status: "deprecated",
      action: "warn",
      shutdownAt: "2026-08-10",
    });
    expect(getModelLifecycleDecision("opencode-zen", "gpt-5.2-codex", CURRENT_DATE)).toMatchObject({
      status: "untracked",
      action: "allow",
    });
    const log = { warn: vi.fn() };
    expect(checkModelLifecycle({
      provider: "openai",
      canonicalModel: "gpt-5.3-chat-latest",
      upstreamModel: "gpt-5.3-chat-latest",
      log,
      asOf: CURRENT_DATE,
    })).toBeNull();
    expect(log.warn).toHaveBeenCalledWith("MODEL_LIFECYCLE", expect.stringMatching(/deprecated/));
  });

  it("does not guess a record for OpenAI's conflicted gpt-4-1106-preview date", () => {
    expect(MODEL_LIFECYCLE_RECORDS.some(({ model }) => model === "gpt-4-1106-preview")).toBe(false);
  });

  it("rejects a shutdown canonical or upstream model with OpenAI-compatible 410", () => {
    for (const model of ["gpt-5.2-codex", "gpt-5.3-chat-latest"]) {
      const result = checkModelLifecycle({
        provider: "openai",
        canonicalModel: model === "gpt-5.2-codex" ? model : "active-alias",
        upstreamModel: model,
        asOf: new Date("2026-08-11T00:00:00.000Z"),
      });
      expect(result).toMatchObject({
        success: false,
        status: 410,
        error: expect.stringMatching(/cannot be routed automatically/),
      });
    }
  });
});
