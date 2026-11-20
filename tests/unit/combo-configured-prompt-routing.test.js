import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import "../translator/registerAll.js";
import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

vi.hoisted(() => { globalThis.fetch = () => { throw new Error("Unexpected network access"); }; });
const oldDir = process.env.DATA_DIR;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "combo-prompt-"));
process.env.DATA_DIR = dir;
delete global._dbAdapter;
vi.resetModules();
const db = await import("../../src/lib/db/index.js");
const { handleChat } = await import("../../src/sse/handlers/chat.js");
const { __setOriginalFetchForTesting } = await import("../../open-sse/utils/proxyFetch.js");
let adapter, restoreFetch, wire;
const invoke = (model) => handleChat(new Request("http://fixture.invalid/v1/chat/completions", {
  method: "POST", headers: { "content-type": "application/json", authorization: "Bearer sk-combo-prompt" },
  body: JSON.stringify({ model, stream: false, messages: [{ role: "system", content: "client" }, { role: "user", content: "hello" }] }),
}));
beforeAll(async () => {
  await db.initDb();
  adapter = await import("../../src/lib/db/driver.js").then((m) => m.getAdapter());
  const now = new Date().toISOString();
  adapter.run(`INSERT INTO providerConnections(id, provider, authType, name, priority, isActive, data, createdAt, updatedAt) VALUES('prompt-openai', 'openai', 'apikey', 'fixture', 1, 1, ?, ?, ?)`, [JSON.stringify({ apiKey: "fixture" }), now, now]);
  adapter.run(`INSERT INTO apiKeys(id, key, name, machineId, isActive, allowedCombos, createdAt) VALUES('prompt-key', 'sk-combo-prompt', 'fixture', 'fixture', 1, '[]', ?)`, [now]);
  await db.createCombo({ name: "inner", models: ["openai/gpt-4o-mini"] });
  await db.createCombo({ name: "outer", models: ["inner"] });
  restoreFetch = __setOriginalFetchForTesting(async (_url, init) => {
    const body = JSON.parse(init.body); wire.push(body);
    if (body.stream) {
      const chunks = [
        { id: "fixture", object: "chat.completion.chunk", model: body.model, choices: [{ index: 0, delta: { role: "assistant", content: "ok" }, finish_reason: null }] },
        { id: "fixture", object: "chat.completion.chunk", model: body.model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } },
      ];
      return new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
    }
    return Response.json({ id: "fixture", object: "chat.completion", model: body.model, choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } });
  });
});
beforeEach(async () => {
  wire = [];
  await db.updateSettings({ requireApiKey: true, comboStrategy: "fallback", comboStrategies: { outer: { systemPrompt: "legacy ignored" } }, comboPrompts: {}, customPromptEnabled: false, rtkEnabled: false, headroomEnabled: false, cavemanEnabled: false, ponytailEnabled: false });
  await db.updateApiKey("prompt-key", { allowedCombos: [], policy: {}, providerConnectionIds: ["prompt-openai"] });
});
afterAll(async () => {
  restoreFetch?.(); await disposeLoadedRequestDetailsRepo(); global._dbAdapter?.instance?.close?.(); delete global._dbAdapter;
  if (oldDir === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = oldDir;
  fs.rmSync(dir, { recursive: true, force: true });
});
it("persists and routes nested prompts in order, leaving existing combos unchanged", async () => {
  expect((await invoke("outer")).status).toBe(200);
  expect(wire[0].messages[0].content).toBe("client");
  wire = [];
  await db.updateSettings({ comboPrompts: { outer: "outer instruction", inner: "inner instruction" } });
  expect((await db.getSettings()).comboPrompts).toEqual({ outer: "outer instruction", inner: "inner instruction" });
  expect((await invoke("outer")).status).toBe(200);
  expect(wire).toHaveLength(1);
  expect(wire[0].messages[0].content).toBe("client\n\nouter instruction\n\ninner instruction");
});
it("does not bypass model capability restrictions", async () => {
  await db.updateSettings({ comboPrompts: { outer: "outer instruction" } });
  await db.updateApiKey("prompt-key", { policy: { allowedModels: ["openai/gpt-4o"] } });
  expect((await invoke("outer")).ok).toBe(false);
  expect(wire).toHaveLength(0);
});
it("carries outer and inner prompts through a fusion panel", async () => {
  await db.updateSettings({ comboStrategies: { outer: { fallbackStrategy: "fusion", judgeModel: "openai/gpt-4o-mini" } }, comboPrompts: { outer: "outer instruction", inner: "inner instruction" } });
  const response = await invoke("outer");
  expect(response.status).toBe(200);
  expect(wire.some((body) => body.messages.some((message) => typeof message.content === "string" && message.content.includes("outer instruction\n\ninner instruction")))).toBe(true);
});
