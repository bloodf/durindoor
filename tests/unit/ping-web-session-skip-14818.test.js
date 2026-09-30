import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// OmniRoute #14780/#14818: chat probes create real conversations on web-session
// accounts and get them suspended. pingModelByKind MUST NOT dispatch for them.
vi.mock("@/shared/utils/machineId", () => ({
  getConsistentMachineId: vi.fn().mockResolvedValue("machine-id-test"),
}));

const originalFetch = global.fetch;

describe("pingModelByKind web-session providers (#14818)", () => {
  beforeEach(() => {
    vi.resetModules();
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: "hi" } }] }),
    }));
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it.each(["perplexity-web/pplx-auto", "pw/pplx-auto", "chatgpt-web/gpt-5-6", "grok-web/grok-4", "m365copilot/copilot-m365", "copilot-m365-web/copilot-m365"])(
    "skips %s without any request",
    async (model) => {
      const { pingModelByKind } = await import("../../src/app/api/models/test/ping.js");
      const result = await pingModelByKind(model, "llm", "http://local.test");
      expect(result).toMatchObject({ ok: false, skipped: true, status: 422, latencyMs: 0 });
      expect(global.fetch).not.toHaveBeenCalled();
    }
  );

  it("still probes a normal API-key provider", async () => {
    const { pingModelByKind } = await import("../../src/app/api/models/test/ping.js");
    const result = await pingModelByKind("openai/gpt-4o", "llm", "http://local.test");
    expect(result.ok).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("does not skip non-chat kinds or music-only web providers", async () => {
    const { pingModelByKind } = await import("../../src/app/api/models/test/ping.js");
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data: [{ embedding: [0.1] }] }),
    }));
    const embedding = await pingModelByKind("grok-web/embed", "embedding", "http://local.test");
    expect(embedding.skipped).toBeUndefined();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const music = await pingModelByKind("suno/chirp", "llm", "http://local.test");
    expect(music.skipped).toBeUndefined();
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
