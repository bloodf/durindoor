/**
 * Regression test for #1062:
 * GitHub Copilot's /responses endpoint only serves OpenAI (gpt/codex) models.
 * Gemini/Claude models must never be routed/escalated there, otherwise they
 * fail with a misleading 400 "does not support Responses API".
 */

import { describe, it, expect, vi } from "vitest";
import { GithubExecutor } from "../../open-sse/executors/github.js";
import { BaseExecutor } from "../../open-sse/executors/base.js";

describe("GithubExecutor.supportsResponsesEndpoint", () => {
  const exec = new GithubExecutor();

  it("excludes Gemini models from the /responses endpoint", () => {
    expect(exec.supportsResponsesEndpoint("gemini-3.1-pro-preview")).toBe(false);
    expect(exec.supportsResponsesEndpoint("gemini-3.1-pro-low")).toBe(false);
  });

  it("excludes Claude models from the /responses endpoint", () => {
    expect(exec.supportsResponsesEndpoint("claude-sonnet-4.6")).toBe(false);
    expect(exec.supportsResponsesEndpoint("claude-opus-4.7")).toBe(false);
  });

  it("allows OpenAI/codex models on the /responses endpoint", () => {
    expect(exec.supportsResponsesEndpoint("gpt-5.5-codex")).toBe(true);
    expect(exec.supportsResponsesEndpoint("o4-mini")).toBe(true);
    expect(exec.supportsResponsesEndpoint("gpt-4.1")).toBe(true);
  });

  it("is null-safe", () => {
    expect(exec.supportsResponsesEndpoint(undefined)).toBe(true);
    expect(exec.supportsResponsesEndpoint("")).toBe(true);
  });
});

describe("GithubExecutor.execute cached-route guard (#1062)", () => {
  it("does NOT use /responses for a Gemini model even if it was wrongly cached as codex", async () => {
    const exec = new GithubExecutor();
    // Simulate a prior misclassification that cached the Gemini model.
    exec.knownCodexModels.add("gemini-3.1-pro-preview");

    const respSpy = vi
      .spyOn(exec, "executeWithResponsesEndpoint")
      .mockResolvedValue({ via: "responses" });
    // Short-circuit the /chat/completions path (BaseExecutor.execute).
    const baseSpy = vi
      .spyOn(Object.getPrototypeOf(Object.getPrototypeOf(exec)), "execute")
      .mockResolvedValue({ response: { status: 200 }, via: "chat" });

    const result = await exec.execute({ model: "gemini-3.1-pro-preview", body: { messages: [] }, log: null });

    expect(respSpy).not.toHaveBeenCalled();
    expect(baseSpy).toHaveBeenCalled();
    expect(result.via).toBe("chat");
  });

  it("aborts a stalled 400 route-escalation probe", async () => {
    const exec = new GithubExecutor();
    const controller = new AbortController();
    const baseSpy = vi.spyOn(BaseExecutor.prototype, "execute").mockResolvedValue({
      response: new Response(new ReadableStream({ pull: () => new Promise(() => {}) }), { status: 400 }),
    });
    try {
      const pending = exec.execute({
        model: "gpt-5.5-codex",
        body: { messages: [] },
        signal: controller.signal,
        log: { warn: vi.fn() },
      });
      await Promise.resolve();
      controller.abort();
      await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    } finally {
      baseSpy.mockRestore();
    }
  });

  it("does not escalate from a route hint beyond the bounded 400 body", async () => {
    const exec = new GithubExecutor();
    const baseSpy = vi.spyOn(BaseExecutor.prototype, "execute").mockResolvedValue({
      response: new Response(
        `${"x".repeat(70 * 1024)} not accessible via the /chat/completions endpoint`,
        { status: 400 },
      ),
    });
    const responsesSpy = vi.spyOn(exec, "executeWithResponsesEndpoint");
    try {
      const result = await exec.execute({
        model: "gpt-5.5-codex",
        body: { messages: [] },
        log: { warn: vi.fn() },
      });
      expect(result.response.status).toBe(400);
      expect(responsesSpy).not.toHaveBeenCalled();
    } finally {
      responsesSpy.mockRestore();
      baseSpy.mockRestore();
    }
  });

  it("does not await a cancellation-resistant 400 body before escalation", async () => {
    const exec = new GithubExecutor();
    const cancel = vi.fn(() => new Promise(() => {}));
    const baseSpy = vi.spyOn(BaseExecutor.prototype, "execute").mockResolvedValue({
      response: {
        status: 400,
        clone: () => new Response("not accessible via the /chat/completions endpoint", { status: 400 }),
        body: { cancel },
      },
    });
    const responsesSpy = vi.spyOn(exec, "executeWithResponsesEndpoint").mockResolvedValue({ via: "responses" });
    try {
      await expect(exec.execute({
        model: "gpt-5.5-codex",
        body: { messages: [] },
        log: { warn: vi.fn() },
      })).resolves.toEqual({ via: "responses" });
      expect(cancel).toHaveBeenCalledOnce();
      expect(responsesSpy).toHaveBeenCalledOnce();
    } finally {
      responsesSpy.mockRestore();
      baseSpy.mockRestore();
    }
  });
});
