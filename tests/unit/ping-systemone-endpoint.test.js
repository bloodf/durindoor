import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// System One (Jev) decision models cannot accept a chat-completions probe.
// Pin the systemone branch: it MUST hit /api/v1/systemone with a native
// state+questions body and MUST NOT fall through to chat completions.
const mocks = vi.hoisted(() => ({
  getApiKeys: vi.fn(),
  getConsistentMachineId: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getApiKeys: mocks.getApiKeys,
}));

vi.mock("@/shared/utils/machineId", () => ({
  getConsistentMachineId: mocks.getConsistentMachineId,
}));

const originalFetch = global.fetch;

describe("pingModelByKind systemone endpoint", () => {
  let calls;

  beforeEach(() => {
    vi.resetModules();
    mocks.getApiKeys.mockResolvedValue([]);
    mocks.getConsistentMachineId.mockResolvedValue("machine-id-test");
    calls = [];
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("calls POST /api/v1/systemone, not /api/v1/chat/completions", async () => {
    global.fetch = vi.fn(async (url) => {
      calls.push(String(url));
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ answers: { probe: { type: "noul", noul: 0.8 } } }),
      };
    });

    const { pingModelByKind } = await import("../../src/app/api/models/test/ping.js");
    const result = await pingModelByKind("opencode-zen/jev-1.13", "systemone", "http://local.test");

    expect(result.ok).toBe(true);
    expect(calls.some((u) => u === "http://local.test/api/v1/systemone")).toBe(true);
    expect(calls.some((u) => u.endsWith("/api/v1/chat/completions"))).toBe(false);

    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe("http://local.test/api/v1/systemone");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body.model).toBe("opencode-zen/jev-1.13");
    expect(body.state).toMatch(/charged twice/i);
    expect(body.questions.probe.type).toBe("noul");
  });

  it("provider returns no answers → ok:false", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ answers: {} }),
    }));

    const { pingModelByKind } = await import("../../src/app/api/models/test/ping.js");
    const result = await pingModelByKind("opencode-zen/jev-1.13", "systemone", "http://local.test");

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no answers/i);
  });

  it("upstream HTTP error → ok:false with status", async () => {
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ error: { message: "Missing required field: state" } }),
    }));

    const { pingModelByKind } = await import("../../src/app/api/models/test/ping.js");
    const result = await pingModelByKind("opencode-zen/jev-1.13", "systemone", "http://local.test");

    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/Missing required field: state/);
  });
});
