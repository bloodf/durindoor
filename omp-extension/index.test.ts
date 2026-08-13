import { describe, expect, it } from "bun:test";
import durindoorExtension, { mapDurinDoorModels } from "./index";

type Handler = (...args: unknown[]) => unknown;

function fakePi() {
  const handlers = new Map<string, Handler>();
  const commands = new Map<string, { handler: Handler }>();
  const registrations: unknown[] = [];
  const warnings: unknown[] = [];
  const logs: unknown[] = [];

  return {
    pi: {
      logger: {
        debug: (...args: unknown[]) => logs.push(args),
        info: (...args: unknown[]) => logs.push(args),
        warn: (...args: unknown[]) => warnings.push(args),
      },
      on: (event: string, handler: Handler) => handlers.set(event, handler),
      registerCommand: (name: string, command: { handler: Handler }) => commands.set(name, command),
      registerProvider: (...args: unknown[]) => registrations.push(args),
    },
    handlers,
    commands,
    registrations,
    warnings,
    logs,
  };
}

async function withEnv(
  values: { DURINDOOR_BASE_URL?: string; DURINDOOR_API_KEY?: string },
  run: () => Promise<void>,
): Promise<void> {
  const originalBaseUrl = process.env.DURINDOOR_BASE_URL;
  const originalApiKey = process.env.DURINDOOR_API_KEY;
  if (values.DURINDOOR_BASE_URL === undefined) delete process.env.DURINDOOR_BASE_URL;
  else process.env.DURINDOOR_BASE_URL = values.DURINDOOR_BASE_URL;
  if (values.DURINDOOR_API_KEY === undefined) delete process.env.DURINDOOR_API_KEY;
  else process.env.DURINDOOR_API_KEY = values.DURINDOOR_API_KEY;
  try {
    await run();
  } finally {
    if (originalBaseUrl === undefined) delete process.env.DURINDOOR_BASE_URL;
    else process.env.DURINDOOR_BASE_URL = originalBaseUrl;
    if (originalApiKey === undefined) delete process.env.DURINDOOR_API_KEY;
    else process.env.DURINDOOR_API_KEY = originalApiKey;
  }
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

  it("maps exact gateway model effort surfaces", () => {
    const { models } = mapDurinDoorModels([
      {
        id: "kimi/kimi-k3",
        capabilities: {
          reasoning: true,
          thinkingFormat: "kimi",
          thinkingCanDisable: false,
          contextWindow: 262_144,
          maxOutput: 131_072,
        },
      },
      {
        id: "cx/gpt-5.6-sol-review",
        capabilities: {
          reasoning: true,
          thinkingFormat: "openai",
          thinkingCanDisable: true,
          contextWindow: 1_050_000,
          maxOutput: 128_000,
        },
      },
    ]);

    expect(models[0]?.thinking).toEqual({ mode: "effort", efforts: ["max"], requiresEffort: true });
    expect(models[1]?.thinking).toEqual({
      mode: "effort",
      efforts: ["minimal", "low", "medium", "high", "xhigh", "max"],
      requiresEffort: false,
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
    await withEnv({ DURINDOOR_BASE_URL: "http://127.0.0.1:1/v1", DURINDOOR_API_KEY: "test" }, async () => {
      const state = fakePi();
      durindoorExtension(state.pi as never);

      await expect(state.handlers.get("session_start")?.({}, {})).resolves.toBeUndefined();
      expect(state.registrations).toHaveLength(0);
      expect(state.warnings).toHaveLength(1);
    });
  });

  it.each([
    ["non-200 response", new Response("unavailable", { status: 503 })],
    ["malformed JSON", new Response("{}", { status: 200, headers: { "content-type": "application/json" } })],
  ])("returns cleanly for %s", async (_name, response) => {
    await withEnv({}, async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () => response;
      try {
        const state = fakePi();
        durindoorExtension(state.pi as never);

        await expect(state.handlers.get("session_start")?.({}, {})).resolves.toBeUndefined();
        expect(state.registrations).toHaveLength(0);
        expect(state.warnings).toHaveLength(1);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  it("does not erase registered models when refresh has no usable entries", async () => {
    await withEnv({}, async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () =>
        new Response('{"data":[{"id":"bad","capabilities":{"contextWindow":0,"maxOutput":1}}]}', {
          headers: { "content-type": "application/json" },
        });
      try {
        const state = fakePi();
        durindoorExtension(state.pi as never);

        await expect(state.handlers.get("session_start")?.({}, {})).resolves.toBeUndefined();
        expect(state.registrations).toHaveLength(0);
        expect(state.warnings).toHaveLength(1);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  it("uses environment URL and key without logging key material", async () => {
    await withEnv(
      { DURINDOOR_BASE_URL: "http://gateway.test/v1/", DURINDOOR_API_KEY: "super-secret-never-log" },
      async () => {
        const originalFetch = globalThis.fetch;
        let requestUrl: string | URL | Request | undefined;
        let requestInit: RequestInit | undefined;
        globalThis.fetch = async (url, init) => {
          requestUrl = url;
          requestInit = init;
          return new Response(
            '{"data":[{"id":"cx/gpt-5.6-sol","capabilities":{"reasoning":true,"thinkingFormat":"openai","thinkingCanDisable":true,"thinkingRange":null,"contextWindow":1050000,"maxOutput":128000}}]}',
            { headers: { "content-type": "application/json" } },
          );
        };
        try {
          const state = fakePi();
          durindoorExtension(state.pi as never);

          await expect(state.handlers.get("session_start")?.({}, {})).resolves.toBeUndefined();
          expect(requestUrl).toBe("http://gateway.test/v1/models");
          expect(requestInit?.headers).toEqual({ Authorization: "Bearer super-secret-never-log" });
          expect(state.registrations).toEqual([
            [
              "durindoor",
              expect.objectContaining({
                baseUrl: "http://gateway.test/v1/",
                apiKey: "super-secret-never-log",
                authHeader: true,
                api: "openai-completions",
                models: [
                  expect.objectContaining({
                    id: "cx/gpt-5.6-sol",
                    contextWindow: 1_050_000,
                    maxTokens: 128_000,
                    thinking: expect.objectContaining({ requiresEffort: false }),
                  }),
                ],
              }),
            ],
          ]);
          expect(state.logs[0]).toEqual(["DurinDoor API key configuration", { found: true }]);
          expect(JSON.stringify([...state.logs, ...state.warnings])).not.toContain("super-secret-never-log");
        } finally {
          globalThis.fetch = originalFetch;
        }
      },
    );
  });

  it("uses default URL and registers without auth when key is absent", async () => {
    await withEnv({}, async () => {
      const originalFetch = globalThis.fetch;
      let requestUrl: string | URL | Request | undefined;
      let requestInit: RequestInit | undefined;
      globalThis.fetch = async (url, init) => {
        requestUrl = url;
        requestInit = init;
        return new Response(
          '{"data":[{"id":"xai/grok-3","capabilities":{"reasoning":false,"contextWindow":204800,"maxOutput":131072}}]}',
          { headers: { "content-type": "application/json" } },
        );
      };
      try {
        const state = fakePi();
        durindoorExtension(state.pi as never);

        await expect(state.handlers.get("session_start")?.({}, {})).resolves.toBeUndefined();
        expect(requestUrl).toBe("http://127.0.0.1:11434/v1/models");
        expect(requestInit?.headers).toBeUndefined();
        const provider = (state.registrations[0] as [string, Record<string, unknown>])[1];
        expect(provider.apiKey).toBe("N/A");
        expect(provider).not.toHaveProperty("authHeader");
        expect(state.logs[0]).toEqual(["DurinDoor API key configuration", { found: false }]);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
