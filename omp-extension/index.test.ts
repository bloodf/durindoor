import { describe, expect, it } from "bun:test";
import durindoorExtension, { mapDurinDoorModels } from "./index";

type Handler = (...args: unknown[]) => unknown;

function fakePi(config: Record<string, unknown> = {}) {
  const handlers = new Map<string, Handler>();
  const commands = new Map<string, { handler: Handler }>();
  const registrations: unknown[] = [];
  const warnings: unknown[] = [];

  return {
    pi: {
      config: { get: (key: string) => config[key] },
      logger: { info() {}, warn: (...args: unknown[]) => warnings.push(args) },
      on: (event: string, handler: Handler) => handlers.set(event, handler),
      registerCommand: (name: string, command: { handler: Handler }) => commands.set(name, command),
      registerProvider: (...args: unknown[]) => registrations.push(args),
    },
    handlers,
    commands,
    registrations,
    warnings,
  };
}

describe("DurinDoor model mapping", () => {
  it("maps omp token, input, reasoning, tool, and thinking fields", () => {
    const { models, skipped } = mapDurinDoorModels([
      {
        id: "xai/grok-4.6",
        capabilities: {
          vision: true,
          tools: true,
          search: true,
          reasoning: true,
          thinkingFormat: "openai",
          thinkingCanDisable: false,
          thinkingRange: { min: 1_024, max: 32_768 },
          contextWindow: 500_000,
          maxOutput: 128_000,
        },
      },
      { id: "bad-window", capabilities: { contextWindow: 0, maxOutput: 1 } },
    ]);

    expect(skipped).toBe(1);
    expect(models).toEqual([
      {
        id: "xai/grok-4.6",
        name: "xai/grok-4.6",
        reasoning: true,
        input: ["text", "image"],
        supportsTools: true,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 500_000,
        maxTokens: 128_000,
        compat: { thinkingFormat: "openai" },
        thinking: {
          mode: "effort",
          efforts: ["minimal", "low", "medium", "high", "xhigh"],
          requiresEffort: true,
        },
      },
    ]);
  });

  it("keeps Chat Completions wire format while mapping upstream effort levels", () => {
    const { models } = mapDurinDoorModels([
      {
        id: "cc/claude-opus-5",
        capabilities: {
          reasoning: true,
          thinkingFormat: "claude-adaptive",
          thinkingCanDisable: true,
          thinkingRange: null,
          contextWindow: 1_000_000,
          maxOutput: 128_000,
        },
      },
    ]);

    expect(models[0]).toMatchObject({
      id: "cc/claude-opus-5",
      compat: { thinkingFormat: "openai" },
      thinking: { mode: "effort", efforts: ["low", "medium", "high", "max"], requiresEffort: false },
    });
  });

  it("skips malformed entries and non-positive output limits", () => {
    const { models, skipped } = mapDurinDoorModels([
      null,
      { id: "missing-capabilities" },
      { id: "bad-output", capabilities: { contextWindow: 1, maxOutput: 0 } },
    ]);

    expect(models).toEqual([]);
    expect(skipped).toBe(3);
  });
});

describe("DurinDoor extension lifecycle", () => {
  it("registers lifecycle and refresh handlers without runtime work at module load", () => {
    const state = fakePi();
    durindoorExtension(state.pi as never);

    expect(state.registrations).toHaveLength(0);
    expect(state.handlers.has("session_start")).toBe(true);
    expect(state.commands.has("durindoor-refresh")).toBe(true);
  });

  it("returns cleanly when the configured gateway is down", async () => {
    const state = fakePi({ "durindoor.baseUrl": "http://127.0.0.1:1/v1", "durindoor.apiKey": "test" });
    durindoorExtension(state.pi as never);

    await expect(state.handlers.get("session_start")?.({}, {})).resolves.toBeUndefined();
    expect(state.registrations).toHaveLength(0);
    expect(state.warnings).toHaveLength(1);
  });

  it.each([
    ["non-200 response", new Response("unavailable", { status: 503 })],
    ["malformed JSON", new Response("{}", { status: 200, headers: { "content-type": "application/json" } })],
  ])("returns cleanly for %s", async (_name, response) => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => response;
    try {
      const state = fakePi({ "durindoor.apiKey": "test" });
      durindoorExtension(state.pi as never);

      await expect(state.handlers.get("session_start")?.({}, {})).resolves.toBeUndefined();
      expect(state.registrations).toHaveLength(0);
      expect(state.warnings).toHaveLength(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("does not erase registered models when refresh has no usable entries", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response('{"data":[{"id":"bad","capabilities":{"contextWindow":0,"maxOutput":1}}]}', {
        headers: { "content-type": "application/json" },
      });
    try {
      const state = fakePi({ "durindoor.apiKey": "test" });
      durindoorExtension(state.pi as never);

      await expect(state.handlers.get("session_start")?.({}, {})).resolves.toBeUndefined();
      expect(state.registrations).toHaveLength(0);
      expect(state.warnings).toHaveLength(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("registers provider-qualified gateway models through Chat Completions", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        '{"data":[{"id":"cx/gpt-5.6-sol","capabilities":{"reasoning":true,"thinkingFormat":"openai","thinkingCanDisable":true,"thinkingRange":null,"contextWindow":1050000,"maxOutput":128000}}]}',
        { headers: { "content-type": "application/json" } },
      );
    try {
      const state = fakePi({ "durindoor.apiKey": "test" });
      durindoorExtension(state.pi as never);

      await expect(state.handlers.get("session_start")?.({}, {})).resolves.toBeUndefined();
      expect(state.registrations).toEqual([
        [
          "durindoor",
          expect.objectContaining({
            api: "openai-completions",
            models: [expect.objectContaining({ id: "cx/gpt-5.6-sol", contextWindow: 1_050_000, maxTokens: 128_000 })],
          }),
        ],
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
