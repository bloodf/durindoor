import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";
import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

vi.hoisted(() => {
  globalThis.fetch = () => { throw new Error("Unexpected network access in nested fusion imports"); };
});

// Keep admission, nested selection, ACLs, credentials, translation and chatCore real.
// Fusion must never turn a rejected media leaf into a successful stripped answer.
const originalDataDir = process.env.DATA_DIR;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-fusion-nested-media-"));
process.env.DATA_DIR = tempDir;
delete global._dbAdapter;
vi.resetModules();
const db = await import("../../src/lib/db/index.js");
const { handleChat } = await import("../../src/sse/handlers/chat.js");
const { __setOriginalFetchForTesting } = await import("../../open-sse/utils/proxyFetch.js");
const { resetComboRotation, resetComboScoring } = await import("../../open-sse/services/combo.js");
const AUTH_KEY = "sk-nested-media-fixture";
const TEXT = "openai/gpt-4o-mini";
const ANSWER = "fixture answer even if the attachment was stripped";
const cases = [
  { media: "image", capable: "openai/gpt-4o", survivor: "openai/gpt-4.1",
    attachment: { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII=" } } },
  { media: "PDF", capable: "openai/gpt-4o", survivor: "openai/gpt-4.1",
    attachment: { type: "file", file: { filename: "report.pdf", file_data: "data:application/pdf;base64,JVBERi0xLjcK" } } },
  // Operator video overrides below make both OpenAI Chat routes capable,
  // letting us compare the exact attachment on wire.
  { media: "video", capable: "nvidia/moonshotai/kimi-k2.6", survivor: "openrouter/moonshotai/kimi-k3",
    attachment: { type: "video_url", video_url: { url: "data:video/mp4;base64,AAAAHGZ0eXBtcDQy" } } },
];
let adapter;
let restoreFetch;
let wire = [];
let unavailableModel;

function invoke(model, attachment) {
  return handleChat(new Request("http://nested-media.invalid/v1/chat/completions", {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${AUTH_KEY}` },
    body: JSON.stringify({ model, stream: false, messages: [
      { role: "user", content: [{ type: "text", text: "Inspect this attachment" }, attachment] },
    ] }),
  }));
}

function assertAttachment(sent, attachment) {
  expect(sent.body.messages[0]).toEqual({ role: "user", content: [
    { type: "text", text: "Inspect this attachment" }, attachment,
  ] });
}

beforeAll(async () => {
  await db.initDb();
  adapter = await import("../../src/lib/db/driver.js").then((module) => module.getAdapter());
  const now = new Date().toISOString();
  for (const provider of ["openai", "nvidia", "openrouter"]) adapter.run(
    `INSERT INTO providerConnections(id, provider, authType, name, priority, isActive, data, createdAt, updatedAt)
     VALUES(?, ?, 'apikey', ?, 1, 1, ?, ?, ?)`,
    [`nested-${provider}`, provider, provider, JSON.stringify({ apiKey: `fixture-${provider}` }), now, now],
  );
  adapter.run(`INSERT INTO apiKeys(id, key, name, machineId, isActive, allowedCombos, createdAt)
    VALUES('nested-key', ?, 'nested', 'fixture-machine', 1, '[]', ?)`, [AUTH_KEY, now]);
  // Same operator metadata fixtures as combo-fusion-media-wire.test.js.
  for (const id of ["gpt-4o", "gpt-4.1"]) await db.addCustomModel({ providerAlias: "openai", id, capabilities: { vision: true, pdf: true } });
  await db.addCustomModel({ providerAlias: "openai", id: "gpt-4o-mini", capabilities: { vision: false, pdf: false, videoInput: false } });
  await db.addCustomModel({ providerAlias: "openrouter", id: "moonshotai/kimi-k3", capabilities: { videoInput: true } });
  await db.addCustomModel({ providerAlias: "nvidia", id: "moonshotai/kimi-k2.6", capabilities: { videoInput: true } });
  for (const row of cases) {
    await db.createCombo({ name: `nested-${row.media}`, models: [row.capable, TEXT] });
    await db.createCombo({ name: `survivor-${row.media}`, models: [row.capable, TEXT, row.survivor] });
    await db.createCombo({ name: `panel-${row.media}`, models: [`nested-${row.media}`] });
    await db.createCombo({ name: `judge-${row.media}`, models: [row.survivor] });
    await db.createCombo({ name: `positive-${row.media}`, models: [`survivor-${row.media}`] });
  }
  restoreFetch = __setOriginalFetchForTesting(async (url, init) => {
    const body = JSON.parse(init.body);
    wire.push({ url: String(url), body });
    if (body.model === unavailableModel) return Response.json(
      { error: { message: "Fixture temporarily unavailable", type: "server_error" } }, { status: 503 },
    );
    if (body.stream) {
      const chunks = [
        { id: "nested-answer", object: "chat.completion.chunk", model: body.model,
          choices: [{ index: 0, delta: { role: "assistant", content: ANSWER }, finish_reason: null }] },
        { id: "nested-answer", object: "chat.completion.chunk", model: body.model,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } },
      ];
      return new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n",
        { headers: { "content-type": "text/event-stream" } });
    }
    return Response.json({ id: "nested-answer", object: "chat.completion", model: body.model,
      choices: [{ index: 0, message: { role: "assistant", content: ANSWER }, finish_reason: "stop" }],
      usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } });
  });
});

beforeEach(async () => {
  // Recreate rows because addCustomModel is insert-only and a case may delete one.
  for (const id of ["gpt-4o", "gpt-4.1"]) {
    await db.deleteCustomModel({ providerAlias: "openai", id });
    await db.addCustomModel({ providerAlias: "openai", id, capabilities: { vision: true, pdf: true } });
  }
  wire = [];
  unavailableModel = undefined;
  resetComboRotation(); resetComboScoring();
  // Remove fixture failure/cooldown state left by retryable-unavailability rows.
  for (const provider of ["openai", "nvidia", "openrouter"]) adapter.run(
    "UPDATE providerConnections SET data = ?, isActive = 1 WHERE id = ?",
    [JSON.stringify({ apiKey: `fixture-${provider}` }), `nested-${provider}`],
  );
  await db.updateApiKey("nested-key", { allowedCombos: [], policy: {},
    providerConnectionIds: ["nested-openai", "nested-nvidia", "nested-openrouter"] });
  const comboStrategies = {};
  for (const row of cases) {
    comboStrategies[`nested-${row.media}`] = { fallbackStrategy: "fallback" };
    comboStrategies[`survivor-${row.media}`] = { fallbackStrategy: "fallback" };
    comboStrategies[`judge-${row.media}`] = { judgeModel: `nested-${row.media}` };
  }
  await db.updateSettings({ requireApiKey: true, comboStrategy: "fusion", comboStrategies,
    fallbackStrategy: "fill-first", pxpipeEnabled: false, rtkEnabled: false, headroomEnabled: false,
    compressionEnabled: false, customPromptEnabled: false, cavemanEnabled: false, ponytailEnabled: false });
});

afterAll(async () => {
  restoreFetch?.();
  await disposeLoadedRequestDetailsRepo();
  global._dbAdapter?.instance?.close?.();
  delete global._dbAdapter;
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

for (const row of cases) describe(`nested fusion ${row.media} admission`, () => {
  for (const role of ["panel", "judge"]) it.each(["ACL denial", "retryable unavailability"])(
    `fails the nested ${role} safely after %s instead of accepting a stripped answer`, async (failure) => {
      if (failure === "ACL denial") await db.updateApiKey("nested-key", {
        policy: { allowedModels: [TEXT, row.survivor] },
      });
      else unavailableModel = row.capable.slice(row.capable.indexOf("/") + 1);
      const response = await invoke(`${role}-${row.media}`, row.attachment);
      const result = await response.json();
      expect(wire.filter((sent) => sent.body.model === "gpt-4o-mini")).toEqual([]);
      expect(response.ok, JSON.stringify(result)).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.choices).toBeUndefined();
      expect(JSON.stringify(result)).not.toContain(ANSWER);
      if (failure === "ACL denial") expect(wire).toHaveLength(role === "panel" ? 0 : 1);
      else expect(wire.some((sent) => sent.body.model === unavailableModel)).toBe(true);
      for (const sent of wire) assertAttachment(sent, row.attachment);
    },
  );

  it("dispatches a capable nested survivor once with the exact attachment", async () => {
    await db.updateApiKey("nested-key", { policy: { allowedModels: [TEXT, row.survivor] } });
    const response = await invoke(`positive-${row.media}`, row.attachment);
    const result = await response.json();
    expect(response.status, JSON.stringify(result)).toBe(200);
    expect(result.choices[0].message.content).toBe(ANSWER);
    expect(wire).toHaveLength(1);
    expect(wire[0].body.model).toBe(row.survivor.slice(row.survivor.indexOf("/") + 1));
    assertAttachment(wire[0], row.attachment);
  });

  it("preserves ordinary fallback's successful text-only fallback after unavailability", async () => {
    unavailableModel = row.capable.slice(row.capable.indexOf("/") + 1);
    const response = await invoke(`nested-${row.media}`, row.attachment);
    const result = await response.json();
    expect(response.status, JSON.stringify(result)).toBe(200);
    expect(result.choices[0].message.content).toBe(ANSWER);
    const textCalls = wire.filter((sent) => sent.body.model === "gpt-4o-mini");
    expect(textCalls).toHaveLength(1);
    expect(wire.some((sent) => sent.body.model === unavailableModel)).toBe(true);
    expect(JSON.stringify(textCalls[0].body.messages)).not.toContain(JSON.stringify(row.attachment));
  });
});


describe("effective fusion leaf capabilities", () => {
  it("dispatches a registry-only capable model without custom enrichment", async () => {
    await db.deleteCustomModel({ providerAlias: "openai", id: "gpt-4o" });
    await db.createCombo({ name: "registry-only-media", models: ["openai/gpt-4o"] });
    const response = await invoke("registry-only-media", cases[0].attachment);
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
    expect(wire).toHaveLength(1);
    assertAttachment(wire[0], cases[0].attachment);
  });

  it("keeps explicit custom false stronger than static capability", async () => {
    await db.updateCustomModel({ providerAlias: "openai", id: "gpt-4o", capabilities: { vision: false } });
    await db.createCombo({ name: "custom-false-media", models: ["openai/gpt-4o"] });
    const response = await invoke("custom-false-media", cases[0].attachment);
    expect(response.status).toBe(400);
    expect(wire).toEqual([]);
  });

  it("preserves resolved capable model aliases", async () => {
    await db.setModelAlias("nested-fixture-vision", "openai/gpt-4o");
    await db.createCombo({ name: "aliased-media", models: ["nested-fixture-vision"] });
    const response = await invoke("aliased-media", cases[0].attachment);
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
    expect(wire).toHaveLength(1);
    assertAttachment(wire[0], cases[0].attachment);
  });

  it("does not bypass custom false through a model alias", async () => {
    await db.updateCustomModel({ providerAlias: "openai", id: "gpt-4o", capabilities: { vision: false } });
    await db.setModelAlias("nested-fixture-blocked", "openai/gpt-4o");
    await db.createCombo({ name: "aliased-false-media", models: ["nested-fixture-blocked"] });
    const response = await invoke("aliased-false-media", cases[0].attachment);
    expect(response.status).toBe(400);
    expect(wire).toEqual([]);
  });
});
