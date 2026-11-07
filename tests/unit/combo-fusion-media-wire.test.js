import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";
import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

vi.hoisted(() => {
  globalThis.fetch = () => { throw new Error("Unexpected network access in fusion wire imports"); };
});

// Reconstructed from the independent review's transport probes. The handler,
// SQLite policy/account selection, translators, core and executor are real;
// only the executor's HTTP transport receives a deterministic response.
const originalDataDir = process.env.DATA_DIR;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-fusion-wire-"));
process.env.DATA_DIR = tempDir;
delete global._dbAdapter;
vi.resetModules();
const db = await import("../../src/lib/db/index.js");
const { handleChat } = await import("../../src/sse/handlers/chat.js");
const { __setOriginalFetchForTesting } = await import("../../open-sse/utils/proxyFetch.js");
const { resetComboRotation, resetComboScoring } = await import("../../open-sse/services/combo.js");
const AUTH_KEY = "sk-fusion-wire-fixture";
const PNG_BYTES = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII=";
const IMAGE = `data:image/png;base64,${PNG_BYTES}`;
const imagePart = () => ({ type: "image_url", image_url: { url: IMAGE } });
const pdfPart = () => ({ type: "file", file: { filename: "report.pdf", file_data: "data:application/pdf;base64,JVBERi0xLjcK" } });
const history = () => [
  { role: "user", content: "inspect the screenshot" },
  { role: "assistant", content: null, tool_calls: [{ id: "wire-shot", type: "function", function: { name: "shot", arguments: "{}" } }] },
  { role: "tool", tool_call_id: "wire-shot", content: [imagePart()] },
];
let adapter;
let restoreFetch;
let wire = [];

function completion(model, stream) {
  const usage = { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 };
  if (!stream) return Response.json({ id: "wire-answer", object: "chat.completion", model,
    choices: [{ index: 0, message: { role: "assistant", content: "fixture answer" }, finish_reason: "stop" }], usage });
  const chunks = [
    { id: "wire-answer", object: "chat.completion.chunk", model,
      choices: [{ index: 0, delta: { role: "assistant", content: "fixture answer" }, finish_reason: null }] },
    { id: "wire-answer", object: "chat.completion.chunk", model,
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage },
  ];
  return new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n",
    { headers: { "content-type": "text/event-stream" } });
}

function invoke(body, endpoint = "/v1/chat/completions") {
  return handleChat(new Request(`http://fusion-wire.invalid${endpoint}`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${AUTH_KEY}` },
    body: JSON.stringify(body),
  }));
}

beforeAll(async () => {
  await db.initDb();
  adapter = await import("../../src/lib/db/driver.js").then((module) => module.getAdapter());
  const now = new Date().toISOString();
  for (const id of ["wire-included", "wire-excluded"]) adapter.run(
    `INSERT INTO providerConnections(id, provider, authType, name, priority, isActive, data, createdAt, updatedAt)
     VALUES(?, 'openai', 'apikey', ?, 1, 1, ?, ?, ?)`,
    [id, id, JSON.stringify({ apiKey: `fixture-${id}` }), now, now],
  );
  adapter.run(`INSERT INTO apiKeys(id, key, name, machineId, isActive, allowedCombos, createdAt)
    VALUES('wire-key', ?, 'wire', 'wire-machine', 1, '[]', ?)`, [AUTH_KEY, now]);
  for (const id of ["gpt-4o", "gpt-4.1"]) await db.addCustomModel({ providerAlias: "openai", id, capabilities: { vision: true, pdf: true } });
  await db.addCustomModel({ providerAlias: "openai", id: "gpt-4o-mini", capabilities: { vision: true, pdf: false } });
  for (const [name, models] of [
    ["wire-panel", ["minimax/MiniMax-M2.1", "openai/gpt-4o", "openai/gpt-4.1"]],
    ["wire-single", ["minimax/MiniMax-M2.1", "openai/gpt-4o"]],
    ["wire-inner", ["openai/gpt-4o", "openai/gpt-4o-mini"]],
    ["wire-nested", ["wire-inner", "openai/gpt-4.1"]],
  ]) await db.createCombo({ name, models, allowedConnectionIds: ["wire-included"] });
  restoreFetch = __setOriginalFetchForTesting(async (url, init) => {
    const body = JSON.parse(init.body);
    wire.push({ url: String(url), body, authorization: new Headers(init.headers).get("authorization") });
    return completion(body.model, body.stream);
  });
});

beforeEach(async () => {
  wire = [];
  resetComboRotation(); resetComboScoring();
  await db.updateApiKey("wire-key", { allowedCombos: [], policy: { allowedModels: ["openai/gpt-4o", "openai/gpt-4.1"] }, providerConnectionIds: ["wire-included"] });
  await db.updateSettings({ requireApiKey: true, comboStrategy: "fusion", comboStrategies: {}, fallbackStrategy: "fill-first",
    pxpipeEnabled: false, rtkEnabled: false, headroomEnabled: false, compressionEnabled: false,
    customPromptEnabled: false, cavemanEnabled: false, ponytailEnabled: false });
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

describe("fusion media at the real executor HTTP boundary", () => {
  it.each([
    { model: "wire-panel", calls: 3, judgeModel: null },
    { model: "wire-single", calls: 1, judgeModel: null },
    { model: "wire-single", calls: 2, judgeModel: "openai/gpt-4.1" },
  ])("sends legal images and paired IDs for $model with judge $judgeModel", async ({ model, calls, judgeModel }) => {
    if (judgeModel) await db.updateSettings({ comboStrategies: { [model]: { judgeModel } } });
    const body = { model, stream: false, messages: history() };
    const original = structuredClone(body);
    const response = await invoke(body);
    expect(response.status, await response.clone().text()).toBe(200);
    await response.text();
    expect(wire).toHaveLength(calls);
    for (const sent of wire) {
      expect(sent.url).toBe("https://api.openai.com/v1/chat/completions");
      expect(sent.authorization).toBe("Bearer fixture-wire-included");
      expect(["gpt-4o", "gpt-4.1"]).toContain(sent.body.model);
      expect(sent.body.messages.slice(0, 4)).toEqual([
        original.messages[0], original.messages[1],
        { role: "tool", tool_call_id: "wire-shot", content: [{ type: "text", text: "[tool returned an image; see attached]" }] },
        { role: "user", content: [imagePart()] },
      ]);
      expect(sent.body.messages.filter((message) => message.role === "tool").every((message) =>
        typeof message.content === "string" || message.content.every((part) => part.type === "text"))).toBe(true);
    }
    if (judgeModel) expect(wire.at(-1).body.model).toBe("gpt-4.1");
    expect(body).toEqual(original);
  });

  it("keeps parallel tool results contiguous before attaching their images", async () => {
    const messages = history();
    messages[1].tool_calls.push({ id: "wire-second", type: "function", function: { name: "shot", arguments: "{}" } });
    messages[2].content.unshift({ type: "text", text: "first screenshot" });
    messages.push({ role: "tool", tool_call_id: "wire-second", content: [imagePart(), { type: "text", text: "second screenshot" }] });
    const response = await invoke({ model: "wire-panel", stream: false, messages });
    expect(response.status, await response.clone().text()).toBe(200);
    await response.text();
    expect(wire).toHaveLength(3);
    for (const sent of wire) expect(sent.body.messages.slice(0, 5)).toEqual([
      messages[0], messages[1],
      { role: "tool", tool_call_id: "wire-shot", content: [{ type: "text", text: "first screenshot" }] },
      { role: "tool", tool_call_id: "wire-second", content: [{ type: "text", text: "second screenshot" }] },
      { role: "user", content: [imagePart(), imagePart()] },
    ]);
  });

  it.each([
    { model: "wire-panel", calls: 3, judgeModel: null },
    { model: "wire-single", calls: 1, judgeModel: null },
    { model: "wire-single", calls: 2, judgeModel: "openai/gpt-4.1" },
  ])("sends legal PDF attachments and paired IDs for $model with judge $judgeModel", async ({ model, calls, judgeModel }) => {
    if (judgeModel) await db.updateSettings({ comboStrategies: { [model]: { judgeModel } } });
    const messages = history();
    messages[2].content = [pdfPart()];
    const response = await invoke({ model, stream: false, messages });
    expect(response.status, await response.clone().text()).toBe(200);
    await response.text();
    expect(wire).toHaveLength(calls);
    for (const sent of wire) {
      expect(sent.authorization).toBe("Bearer fixture-wire-included");
      expect(sent.body.messages.slice(0, 4)).toEqual([
        messages[0], messages[1],
        { role: "tool", tool_call_id: "wire-shot", content: [{ type: "text", text: "[tool returned media; see attached]" }] },
        { role: "user", content: [pdfPart()] },
      ]);
    }
    if (judgeModel) expect(wire.at(-1).body.model).toBe("gpt-4.1");
    expect(messages[2].content).toEqual([pdfPart()]);
  });

  it("preserves attachment order and parallel IDs for mixed image/PDF results through the judge", async () => {
    const messages = history();
    messages[1].tool_calls.push({ id: "wire-second", type: "function", function: { name: "read", arguments: "{}" } });
    messages[2].content = [imagePart(), { type: "text", text: "first result" }, pdfPart()];
    messages.push({ role: "tool", tool_call_id: "wire-second", content: [pdfPart(), imagePart(), { type: "text", text: "second result" }] });
    await db.updateSettings({ comboStrategies: { "wire-panel": { judgeModel: "openai/gpt-4.1" } } });
    const response = await invoke({ model: "wire-panel", stream: false, messages });
    expect(response.status, await response.clone().text()).toBe(200);
    await response.text();
    expect(wire).toHaveLength(3);
    for (const sent of wire) expect(sent.body.messages.slice(0, 5)).toEqual([
      messages[0], messages[1],
      { role: "tool", tool_call_id: "wire-shot", content: [{ type: "text", text: "first result" }] },
      { role: "tool", tool_call_id: "wire-second", content: [{ type: "text", text: "second result" }] },
      { role: "user", content: [imagePart(), pdfPart(), pdfPart(), imagePart()] },
    ]);
    expect(wire.at(-1).body.model).toBe("gpt-4.1");
  });

  it.each([false, true])("keeps lifted PDFs hard requirements across nested fallback after local model denial (image=%s)", async (withImage) => {
    await db.updateApiKey("wire-key", { policy: { allowedModels: ["openai/gpt-4.1", "openai/gpt-4o-mini"] } });
    await db.updateSettings({ comboStrategies: {
      "wire-inner": { fallbackStrategy: "fallback" }, "wire-nested": { judgeModel: "openai/gpt-4.1" },
    } });
    const messages = history();
    messages[2].content = withImage ? [pdfPart(), imagePart()] : [pdfPart()];
    const response = await invoke({ model: "wire-nested", stream: false, messages });
    expect(response.status, await response.clone().text()).toBe(200);
    await response.text();
    expect(wire.map((sent) => sent.body.model)).toEqual(["gpt-4.1", "gpt-4.1"]);
    for (const sent of wire) {
      expect(sent.authorization).toBe("Bearer fixture-wire-included");
      expect(sent.body.messages.slice(2, 4)).toEqual([
        { role: "tool", tool_call_id: "wire-shot", content: [{ type: "text", text: "[tool returned media; see attached]" }] },
        { role: "user", content: withImage ? [pdfPart(), imagePart()] : [pdfPart()] },
      ]);
    }
  });

  it("rejects an explicit PDF-incapable judge before transport", async () => {
    await db.updateApiKey("wire-key", { policy: { allowedModels: ["openai/gpt-4o", "openai/gpt-4o-mini"] } });
    await db.updateSettings({ comboStrategies: { "wire-single": { judgeModel: "openai/gpt-4o-mini" } } });
    const messages = history();
    messages[2].content = [pdfPart()];
    const response = await invoke({ model: "wire-single", stream: false, messages });
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("capability_unavailable");
    expect(wire).toHaveLength(0);
  });

  it("retains the documented Claude base64 tool-image conversion limitation", async () => {
    const response = await invoke({ model: "wire-panel", stream: false, max_tokens: 128, messages: [
      { role: "user", content: "inspect" },
      { role: "assistant", content: [{ type: "tool_use", id: "wire-shot", name: "shot", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "wire-shot", content: [
        { type: "image", source: { type: "base64", media_type: "image/png", data: PNG_BYTES } },
      ] }] },
    ] }, "/v1/messages");
    expect(response.status, await response.clone().text()).toBe(200);
    await response.text();
    expect(wire).toHaveLength(3);
    for (const sent of wire) {
      expect(JSON.stringify(sent.body)).toContain("[tool result omitted image: image/png]");
      expect(JSON.stringify(sent.body)).not.toContain(PNG_BYTES);
    }
  });

  it("keeps unsupported Claude tool documents explicit instead of dropping bytes", async () => {
    const response = await invoke({ model: "wire-single", stream: false, max_tokens: 128, messages: [
      { role: "user", content: "inspect" },
      { role: "assistant", content: [{ type: "tool_use", id: "wire-pdf", name: "read", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "wire-pdf", content: [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: "JVBERi0xLjcK" } },
      ] }] },
    ] }, "/v1/messages");
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("UNSUPPORTED_DOCUMENT");
    expect(wire).toHaveLength(0);
  });
});
