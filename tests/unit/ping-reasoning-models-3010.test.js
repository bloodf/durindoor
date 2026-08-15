// Issue #3010 — Dashboard "Test" button fails for reasoning models because of a
// max_tokens:16 probe budget. Reasoning models burn that budget on chain-of-thought
// before emitting an answer, so the probe reports "no completion choices" even though
// the connection works. Raise the budget and soft-pass reasoning-only responses.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pingModelByKind } from "../../src/app/api/models/test/ping.js";

vi.mock("@/shared/utils/machineId", () => ({
  getConsistentMachineId: vi.fn().mockResolvedValue("machine-id-test"),
}));

describe("pingModelByKind reasoning models (#3010)", () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function jsonResponse(obj) {
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(obj),
      json: async () => obj,
    };
  }

  it("uses a 1024-token budget for the chat completions probe", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ choices: [{ message: { content: "Hi there!" } }] }));

    await pingModelByKind("cline-pass/kimi-k3", "llm", "http://127.0.0.1:20127");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.max_tokens).toBe(1024);
  });

  it("treats a reasoning-only (length-limited) response as ok:true", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        choices: [
          {
            finish_reason: "length",
            message: { content: "", reasoning: "The user said hi — a simple greeting..." },
          },
        ],
      })
    );

    const result = await pingModelByKind("cline-pass/kimi-k3", "llm", "http://127.0.0.1:20127");
    expect(result.ok).toBe(true);
    expect(result.note).toMatch(/reasoning-only/);
  });

  it("still fails when there are no choices and no reasoning", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ choices: [] }));
    const result = await pingModelByKind("some/model", "llm", "http://127.0.0.1:20127");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no completion choices/);
  });

  it("rejects provider error statuses without a message", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ status: 401, choices: [{ message: { content: "Hello!" } }] }));
    const result = await pingModelByKind("some/model", "llm", "http://127.0.0.1:20127");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Provider status 401/);
  });

  it("rejects blank completion content unless it is the reasoning-only exception", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ choices: [{ finish_reason: "length", message: { content: "" } }] }));
    const result = await pingModelByKind("some/model", "llm", "http://127.0.0.1:20127");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/empty completion content/);
  });

  it("passes a normal answer with the larger budget", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ choices: [{ message: { content: "Hello!" } }] }));
    const result = await pingModelByKind("openai/gpt-4o", "llm", "http://127.0.0.1:20127");
    expect(result.ok).toBe(true);
  });
});
