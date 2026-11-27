import "../translator/registerAll.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveCompressionConfig } from "../../src/shared/utils/compressionConfig.js";
import { runCompressionStage } from "../../open-sse/services/compression/stage.js";
import { runCompressionSeam } from "../../open-sse/handlers/chatCore/compressionHook.js";
import { getEngine } from "../../open-sse/services/compression/index.js";
import { getComboModelsFromData, handleComboChat } from "../../open-sse/services/combo.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(), headroom: vi.fn(), rtk: vi.fn(), pxpipe: vi.fn(), settings: {}, row: {},
  canModify: vi.fn(async () => true),
}));
vi.mock("../../open-sse/executors/index.js", () => ({ getExecutor: () => ({ noAuth: true, execute: mocks.execute }) }));
vi.mock("../../open-sse/rtk/headroom.js", async (original) => ({ ...(await original()), compressWithHeadroom: mocks.headroom }));
vi.mock("../../open-sse/rtk/pxpipe.js", async (original) => ({ ...(await original()), compressWithPxpipe: mocks.pxpipe }));
vi.mock("../../open-sse/rtk/index.js", async (original) => ({ ...(await original()), compressMessages: mocks.rtk }));
vi.mock("../../open-sse/utils/requestLogger.js", () => ({ createRequestLogger: async () => ({
  logClientRawRequest: vi.fn(), logRawRequest: vi.fn(), logTargetRequest: vi.fn(),
  logProviderResponse: vi.fn(), logConvertedResponse: vi.fn(), logError: vi.fn(),
}) }));
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(), finishActiveSession: vi.fn(), appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}), saveRequestUsage: vi.fn(async () => {}),
}));
vi.mock("../../open-sse/handlers/chatCore/proxyTimeline.js", () => ({ startTrace: () => null, record: vi.fn(), finishTrace: vi.fn() }));
// Repository writes use an isolated in-memory row, never the real data directory.
vi.mock("@/lib/db/driver.js", () => ({ getAdapter: async () => ({
  get: () => ({ data: JSON.stringify(mocks.row) }),
  transaction: (fn) => fn(),
  run: (_sql, params) => { mocks.row = JSON.parse(params[0]); },
}) }));
vi.mock("@/lib/localDb", () => ({
  getSettings: async () => mocks.settings, updateSettings: vi.fn(),
  updateSettingsWithPasswordEpoch: vi.fn(), PasswordEpochMismatchError: class extends Error {},
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: vi.fn() }) }));
vi.mock("@/lib/network/outboundProxy", () => ({ applyOutboundProxyEnv: vi.fn() }));
vi.mock("@/dashboardGuard", () => ({ hasValidCliToken: async () => false, isOperatorRequest: async () => true }));
vi.mock("@/lib/settings/settingsPatchAuth", async (original) => ({ ...(await original()), canModifySecurityCriticalSettings: mocks.canModify }));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
const { mergeSettingsPatch, updateSettings, updateSettingsWithPasswordEpoch } = await import("../../src/lib/db/repos/settingsRepo.js");
const { PATCH } = await import("../../src/app/api/settings/route.js");

const body = () => ({ model: "gpt-4o", stream: false, messages: [{ role: "user", content: "Please help me understand all of the repeated words repeated words. ".repeat(12) }] });
const toolBody = () => ({ model: "gpt-4o", stream: false, messages: [
  { role: "user", content: "run a tool" },
  { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "Bash", arguments: '{"command":"git diff"}' } }] },
  { role: "tool", tool_call_id: "call_1", content: "long tool output ".repeat(100) },
  { role: "user", content: "summarize" },
] });
async function run(flags = {}) {
  const events = [];
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), line: vi.fn() };
  const result = await handleChatCore({
    body: body(), modelInfo: { provider: "openai", model: "gpt-4o" },
    credentials: {}, log, connectionId: "private-test", rtkEnabled: false,
    headroomEnabled: false, pxpipeEnabled: false, cavemanEnabled: false,
    clientRawRequest: { endpoint: "/v1/chat/completions", headers: {} },
    onTokenSaverEvent: (event) => events.push(event), ...flags,
  });
  expect(result.response.status).toBe(200);
  return { result, events, log, sent: mocks.execute.mock.calls.at(-1)[0].body };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.row = {};
  mocks.settings = { password: "private-test-hash", headroomEnabled: false };
  mocks.headroom.mockResolvedValue(null);
  mocks.rtk.mockReturnValue(null);
  mocks.pxpipe.mockResolvedValue(null);
  mocks.canModify.mockResolvedValue(true);
  mocks.execute.mockImplementation(async () => ({
    response: Response.json({ id: "private-test", object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }] }),
    url: "https://provider.invalid", headers: {}, transformedBody: null,
  }));
});

describe("#2289 migration-free config and alias writes", () => {
  it("uses defaults for missing keys and never changes input", () => {
    const input = Object.freeze({});
    expect(resolveCompressionConfig(input)).toMatchObject({ rtkEnabled: true, pxpipeEnabled: true, headroomEnabled: false, cavemanEnabled: false, compressionEnabled: false });
    expect(input).toEqual({});
  });
  it.each(["rtk", "headroom"])("keeps legacy true/map false on for %s", (id) => {
    expect(resolveCompressionConfig({ [`${id}Enabled`]: true, compressionEnabled: true, compressionEngines: { [id]: { enabled: false } } })[`${id}Enabled`]).toBe(true);
  });
  it.each([false, true])("flat false/map true needs master=%s", (master) => {
    const config = resolveCompressionConfig({ rtkEnabled: false, headroomEnabled: false, compressionEnabled: master, compressionEngines: { rtk: { enabled: true }, headroom: { enabled: true }, "caveman-prompt": { enabled: true }, pxpipe: { enabled: false } } });
    expect(config.rtkEnabled).toBe(master);
    expect(config.headroomEnabled).toBe(master);
    expect(config.cavemanEnabled).toBe(false);
    expect(config.pxpipeEnabled).toBe(true);
  });
  it.each(["rtk", "headroom", "caveman-prompt", "pxpipe"])("mirrors %s disable and keeps options", (id) => {
    const flat = { rtk: "rtkEnabled", headroom: "headroomEnabled", "caveman-prompt": "cavemanEnabled", pxpipe: "pxpipeEnabled" }[id];
    const current = { [flat]: true, compressionEngines: { [id]: { enabled: true, level: "full" }, lite: { enabled: true } } };
    expect(mergeSettingsPatch(current, { [flat]: false })).toMatchObject({ [flat]: false, compressionEngines: { [id]: { enabled: false, level: "full" }, lite: { enabled: true } } });
    expect(mergeSettingsPatch(current, { compressionEngines: { [id]: { enabled: false } } })[flat]).toBe(false);
  });
  it("never creates absent entries or aliases the caveman rewriter", () => {
    expect(mergeSettingsPatch({}, { rtkEnabled: false, cavemanEnabled: true })).toEqual({ rtkEnabled: false, cavemanEnabled: true });
    expect(mergeSettingsPatch({}, { compressionEngines: { caveman: { enabled: true, level: "ultra" } } })).not.toHaveProperty("cavemanEnabled");
  });
  it("explicit map boolean/level wins conflicts while siblings survive", () => {
    expect(mergeSettingsPatch({ compressionEngines: { lite: { enabled: true } } }, { cavemanEnabled: false, cavemanLevel: "lite", compressionEngines: { "caveman-prompt": { enabled: true, level: "full" } } })).toEqual({ cavemanEnabled: true, cavemanLevel: "full", compressionEngines: { lite: { enabled: true }, "caveman-prompt": { enabled: true, level: "full" } } });
  });
  it.each(["normal", "password epoch"])("mirrors stale rows through the %s repository path", async (mode) => {
    mocks.row = { rtkEnabled: true, passwordSessionEpoch: "test-epoch", compressionEngines: { rtk: { enabled: true, level: 3 } } };
    if (mode === "normal") await updateSettings({ rtkEnabled: false });
    else await updateSettingsWithPasswordEpoch({ rtkEnabled: false }, "test-epoch");
    expect(mocks.row).toMatchObject({ rtkEnabled: false, compressionEngines: { rtk: { enabled: false, level: 3 } } });
  });
  it("requires reauth on the real settings route for nested headroom enable", async () => {
    const response = await PATCH(new Request("http://localhost/api/settings", { method: "PATCH", body: JSON.stringify({ compressionEngines: { headroom: { enabled: true } } }) }));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "REAUTH_REQUIRED", fields: ["headroomEnabled"] });
  });
  it("cannot enable nested headroom without operator authorization", async () => {
    mocks.canModify.mockResolvedValue(false);
    const response = await PATCH(new Request("http://localhost/api/settings", { method: "PATCH", body: JSON.stringify({ compressionEngines: { headroom: { enabled: true } } }) }));
    expect(response.status).toBe(403);
  });

});

describe("#2289 ordered runtime pipeline", () => {
  it.each(["openai", "cursor"])("runs RTK/headroom exactly once with both forms (%s)", async (provider) => {
    const order = [];
    mocks.headroom.mockImplementation(async () => { order.push("headroom"); return null; });
    mocks.rtk.mockImplementation(() => { order.push("rtk"); return null; });
    const rtkStack = vi.spyOn(getEngine("rtk"), "apply");
    const headroomStack = vi.spyOn(getEngine("headroom"), "apply");
    await run({ body: toolBody(), modelInfo: { provider, model: "gpt-4o" }, rtkEnabled: true, headroomEnabled: true, compressionEnabled: true, compressionEngines: { rtk: { enabled: true }, headroom: { enabled: true } } });
    expect(order).toEqual(["headroom", "rtk"]);
    expect(mocks.headroom).toHaveBeenCalledTimes(1);
    expect(mocks.headroom.mock.calls[0][1].format).toBe(FORMATS.OPENAI);
    expect(mocks.rtk).toHaveBeenCalledTimes(1);
    expect(mocks.rtk.mock.calls[0][0].messages.some((message) => message.role === "tool")).toBe(true);
    expect(rtkStack).not.toHaveBeenCalled();
    expect(headroomStack).not.toHaveBeenCalled();
    rtkStack.mockRestore(); headroomStack.mockRestore();
  });
  it("keeps low-level omitted RTK off while settings resolution defaults it on", async () => {
    const { sent } = await run({ body: toolBody(), rtkEnabled: undefined, compressionEnabled: false,
      compressionEngines: { rtk: { enabled: true } } });
    expect(mocks.rtk).not.toHaveBeenCalled();
    expect(sent.messages.find((message) => message.role === "tool").content).toBe(toolBody().messages[2].content);
    expect(resolveCompressionConfig({}).rtkEnabled).toBe(true);
  });
  it("restores the source body after headroom mutates then throws", async () => {
    mocks.headroom.mockImplementation(async (source) => { source.messages = []; throw new Error("private test failure"); });
    const input = body();
    const { sent } = await run({ body: input, headroomEnabled: true });
    expect(sent.messages).toEqual(body().messages);
  });
  it("restores RTK after it mutates then throws", async () => {
    mocks.rtk.mockImplementation((source) => { source.messages = []; throw new Error("test failure"); });
    const { sent } = await run({ body: toolBody(), rtkEnabled: true });
    expect(sent.messages.find((message) => message.role === "tool").tool_call_id).toBe("call_1");
  });
  it("restores PXPIPE after mutation and rejection", async () => {
    mocks.pxpipe.mockImplementation(async (source) => { source.messages = []; throw new Error("test failure"); });
    const { sent } = await run({ pxpipeEnabled: true });
    expect(mocks.pxpipe).toHaveBeenCalledTimes(1);
    expect(sent.messages).toEqual(body().messages);
  });
  it.each([false, true])("uses the resolved aliases at dedicated positions with master=%s", async (enabled) => {
    await run({ body: toolBody(), rtkEnabled: false, headroomEnabled: false, compressionEnabled: enabled,
      compressionEngines: { rtk: { enabled: true }, headroom: { enabled: true } } });
    expect(mocks.rtk).toHaveBeenCalledTimes(enabled ? 1 : 0);
    expect(mocks.headroom).toHaveBeenCalledTimes(enabled ? 1 : 0);
  });
  it("gates dropped tool IDs, thinking and error blocks", async () => {
    const input = { messages: [{ role: "assistant", content: [{ type: "thinking", thinking: "private thought", signature: "sig" }] }, { role: "tool", tool_call_id: "id", content: "failed", is_error: true }] };
    for (const mutate of [(b) => { b.messages[0].content = []; }, (b) => { b.messages[1].content = "changed"; }, (b) => { delete b.messages[1].tool_call_id; }]) {
      const target = structuredClone(input);
      expect(await runCompressionStage(target, (working) => { mutate(working); return true; }, { id: "test" })).toBeNull();
      expect(target).toEqual(input);
    }
  });
  it("keeps prior stack success when a later engine mutates then throws", async () => {
    const input = body();
    const out = await runCompressionSeam(input, {
      deriveDefaultPlan: () => ({}), resolveAdaptivePlan: () => ({}), planToEngineIds: () => ["good", "bad"], isEngineAvailable: () => true,
      getEngine: (id) => ({ apply: async (working) => { working.messages[0].content = id; if (id === "bad") throw new Error("failed"); return { body: working, compressed: true }; } }),
    }, { enabled: true });
    expect(out.body.messages[0].content).toBe("good");
    expect(input).toEqual(body());
  });
  it("captures actual stack savings and distinguishes prompt/rewriter IDs", async () => {
    const { events, log } = await run({ compressionEnabled: true, compressionEngines: { caveman: { enabled: true } }, cavemanEnabled: true, cavemanLevel: "full" });
    expect(events).toHaveLength(1);
    expect(events[0].compression.tokensSaved).toBeGreaterThan(0);
    expect(events[0].stages).toContain("caveman");
    expect(events[0].stages).toContain("caveman-prompt");
    expect(log.line.mock.calls.flat().join(" ")).toContain("CAVEMAN-PROMPT:full");
    expect(log.line.mock.calls.flat().join(" ")).toContain("COMPRESS:caveman|");
  });
  it("routes saved combo fallback through the real compression path", async () => {
    const models = getComboModelsFromData("saved-combo", [{ name: "saved-combo", models: ["openai/failed", "openai/gpt-4o"] }]);
    expect(models).toEqual(["openai/failed", "openai/gpt-4o"]);
    expect(getComboModelsFromData("openai/saved-combo", [{ name: "saved-combo", models }])).toBeNull();
    const attempts = [];
    const response = await handleComboChat({
      body: body(), models, comboName: "private-2289-combo", comboStrategy: "fallback", checkEmptyBody: false,
      log: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
      handleSingleModel: async (source, model) => {
        attempts.push(model);
        if (model === "openai/failed") return Response.json({ error: { message: "unavailable" } }, { status: 503 });
        const { result, events } = await run({ body: source, compressionEnabled: true, compressionEngines: { caveman: { enabled: true } } });
        expect(events[0].compression.tokensSaved).toBeGreaterThan(0);
        return result.response;
      },
    });
    expect(response.status).toBe(200);
    expect(attempts).toEqual(models);
    expect(response.headers.get("X-DurinDoor-Compression")).toMatch(/^caveman\|/);
  });
  it("bypass header disables all saver stages", async () => {
    const { sent } = await run({ rtkEnabled: true, headroomEnabled: true, cavemanEnabled: true, compressionEnabled: true, compressionEngines: { caveman: { enabled: true } }, clientRawRequest: { endpoint: "/v1/chat/completions", headers: { "x-durindoor-token-saver": "off" } } });
    expect(mocks.rtk).not.toHaveBeenCalled(); expect(mocks.headroom).not.toHaveBeenCalled();
    expect(sent.messages).toEqual(body().messages);
  });
});
