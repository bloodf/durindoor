import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const core = vi.hoisted(() => ({
  chat: vi.fn(),
  fetch: vi.fn(),
  search: vi.fn(),
  image: vi.fn(),
  tts: vi.fn(),
  warmLiveModelLimits: vi.fn(),
}));

// The handlers, combo dispatcher, combo-routing policy, and shared credential
// selector are production code. Only provider/network boundaries are replaced.
vi.mock("open-sse/handlers/chatCore.js", () => ({ handleChatCore: core.chat }));
vi.mock("open-sse/handlers/fetch/index.js", () => ({ handleFetchCore: core.fetch }));
vi.mock("open-sse/handlers/search/index.js", () => ({ handleSearchCore: core.search }));
vi.mock("open-sse/handlers/imageGenerationCore.js", () => ({ handleImageGenerationCore: core.image }));
vi.mock("open-sse/handlers/ttsCore.js", () => ({ handleTtsCore: core.tts }));
vi.mock("open-sse/services/liveModelLimits.js", async (importOriginal) => ({
  ...(await importOriginal()),
  warmLiveModelLimits: core.warmLiveModelLimits,
}));

const AUTH_KEY = "sk-combo-allow-list-test";
const originalDataDir = process.env.DATA_DIR;
let tempDir;
let adapter;
let db;
let handlers;
let combos;

const connectionIds = {
  openai: { included: "openai-included", excluded: "openai-excluded" },
  tinyfish: { included: "tinyfish-included", excluded: "tinyfish-excluded" },
  tavily: { included: "tavily-included", excluded: "tavily-excluded" },
  "fish-audio": { included: "fish-included", excluded: "fish-excluded" },
};

function request(url, body, authenticated = true) {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authenticated ? { authorization: `Bearer ${AUTH_KEY}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

function insertConnection(provider, id, priority) {
  const now = "2026-09-04T00:00:00.000Z";
  adapter.run(
    `INSERT INTO providerConnections(id, provider, authType, name, priority, isActive, data, createdAt, updatedAt)
     VALUES(?, ?, 'apikey', ?, ?, 1, ?, ?, ?)`,
    [id, provider, id, priority, JSON.stringify({ apiKey: `key-${id}` }), now, now],
  );
}

async function createCombo(name, models, allowedConnectionIds) {
  return db.createCombo({ name, models, allowedConnectionIds });
}

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-combo-allow-list-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();

  db = await import("../../src/lib/db/index.js");
  await db.initDb();
  adapter = await import("../../src/lib/db/driver.js").then((module) => module.getAdapter());
  await db.updateSettings({
    requireApiKey: true,
    fallbackStrategy: "fill-first",
    comboStrategy: "fallback",
    pxpipeEnabled: false,
    rtkEnabled: false,
    headroomEnabled: false,
  });
  adapter.run(
    `INSERT INTO apiKeys(id, key, name, machineId, isActive, allowedCombos, createdAt)
     VALUES('combo-test-key', ?, 'Combo allow-list test', 'test-machine', 1, '[]', ?)`,
    [AUTH_KEY, "2026-09-04T00:00:00.000Z"],
  );

  for (const [provider, ids] of Object.entries(connectionIds)) {
    insertConnection(provider, ids.included, 1);
    insertConnection(provider, ids.excluded, 2);
  }

  combos = {
    chat: await createCombo("allow-chat", ["openai/gpt-test"], [connectionIds.openai.included]),
    fetch: await createCombo("allow-fetch", ["tinyfish"], [connectionIds.tinyfish.included]),
    search: await createCombo("allow-search", ["tavily"], [connectionIds.tavily.included]),
    image: await createCombo("allow-image", ["openai/dall-e-test"], [connectionIds.openai.included]),
    tts: await createCombo("allow-tts", ["fish-audio/s2.1-pro"], [connectionIds["fish-audio"].included]),
    legacy: await createCombo("legacy-unrestricted", ["openai/gpt-test"], []),
    nestedInner: await createCombo("nested-inner", ["openai/gpt-test"], [connectionIds.openai.excluded]),
    nestedOuter: await createCombo("nested-outer", ["nested-inner"], [connectionIds.openai.included]),
  };

  handlers = {
    chat: await import("../../src/sse/handlers/chat.js").then((module) => module.handleChat),
    fetch: await import("../../src/sse/handlers/fetch.js").then((module) => module.handleFetch),
    search: await import("../../src/sse/handlers/search.js").then((module) => module.handleSearch),
    image: await import("../../src/sse/handlers/imageGeneration.js").then((module) => module.handleImageGeneration),
    tts: await import("../../src/sse/handlers/tts.js").then((module) => module.handleTts),
  };
});

afterAll(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

beforeEach(() => {
  vi.clearAllMocks();
  core.chat.mockResolvedValue({
    success: true,
    response: new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  });
  core.fetch.mockResolvedValue({ success: true, data: { title: "ok", content: "ok", links: [] } });
  core.search.mockResolvedValue({
    success: true,
    data: { results: [{ title: "ok" }] },
    response: new Response(JSON.stringify({ results: [{ title: "ok" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  });
  core.image.mockResolvedValue({
    success: true,
    response: new Response(JSON.stringify({ data: [{ url: "https://example.test/image.png" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  });
  core.tts.mockResolvedValue({
    success: true,
    response: new Response("audio", { status: 200, headers: { "content-type": "audio/mpeg" } }),
  });
});

const modalities = [
  {
    name: "chat",
    provider: "openai",
    core: core.chat,
    invoke: () => handlers.chat(request("http://router.example.test/v1/chat/completions", {
      model: combos.chat.name,
      messages: [{ role: "user", content: "hi" }],
    })),
  },
  {
    name: "fetch",
    provider: "tinyfish",
    core: core.fetch,
    invoke: () => handlers.fetch(request("http://router.example.test/v1/web/fetch", {
      model: combos.fetch.name,
      url: "https://example.com/",
    })),
  },
  {
    name: "search",
    provider: "tavily",
    core: core.search,
    invoke: () => handlers.search(request("http://router.example.test/v1/web/search", {
      model: combos.search.name,
      query: "hello",
    })),
  },
  {
    name: "image generation",
    provider: "openai",
    core: core.image,
    invoke: () => handlers.image(request("http://router.example.test/v1/images/generations", {
      model: combos.image.name,
      prompt: "a cat",
    })),
  },
  {
    name: "text to speech",
    provider: "fish-audio",
    core: core.tts,
    invoke: () => handlers.tts(request("http://router.example.test/v1/audio/speech", {
      model: combos.tts.name,
      input: "hello",
    })),
  },
];

describe("combo connection allow-list dispatch (#747)", () => {
  it.each(modalities)("$name reaches the real dispatcher and selects only the populated allow-list member", async ({ provider, core: providerCore, invoke }) => {
    const response = await invoke();

    expect(response.status).toBe(200);
    expect(providerCore).toHaveBeenCalledOnce();
    const selected = providerCore.mock.calls.map(([input]) => input.credentials?.connectionId);
    expect(selected).toContain(connectionIds[provider].included);
    expect(selected).not.toContain(connectionIds[provider].excluded);
  });

  it("keeps an empty persisted allow-list unrestricted for legacy combos", async () => {
    adapter.run(`UPDATE providerConnections SET isActive = 0 WHERE id = ?`, [connectionIds.openai.included]);
    try {
      const response = await handlers.chat(request("http://router.example.test/v1/chat/completions", {
        model: combos.legacy.name,
        messages: [{ role: "user", content: "hi" }],
      }));

      expect(response.status).toBe(200);
      expect(core.chat.mock.calls.map(([input]) => input.credentials?.connectionId)).toEqual([
        connectionIds.openai.excluded,
      ]);
    } finally {
      adapter.run(`UPDATE providerConnections SET isActive = 1 WHERE id = ?`, [connectionIds.openai.included]);
    }
  });

  it("denies a nested combo whose real allow-list intersection is empty", async () => {
    const response = await handlers.chat(request("http://router.example.test/v1/chat/completions", {
      model: combos.nestedOuter.name,
      messages: [{ role: "user", content: "hi" }],
    }));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: expect.objectContaining({ message: expect.stringContaining("No active credentials") }),
    });
    expect(core.chat).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated remote request before combo dispatch", async () => {
    const response = await handlers.chat(request("http://router.example.test/v1/chat/completions", {
      model: combos.chat.name,
      messages: [{ role: "user", content: "hi" }],
    }, false));

    expect(response.status).toBe(401);
    expect(core.chat).not.toHaveBeenCalled();
  });
});
