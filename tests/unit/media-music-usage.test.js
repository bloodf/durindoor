import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ key: "music-key", keyId: "music-key-id", provider: "suno", allowed: [], denied: false, failLedger: false }));
vi.mock("@/lib/localDb", async () => ({
  saveRequestUsage: async (...args) => {
    if (state.failLedger) throw new Error("ledger unavailable");
    return (await import("@/lib/db/repos/usageRepo.js")).saveRequestUsage(...args);
  },
  getSettings: async () => ({}),
  getApiKeyByKey: async () => null,
  getProviderConnectionById: async () => ({ provider: state.provider }),
  getApiKeyProviderConnectionIds: async () => state.allowed,
}));
vi.mock("@/sse/services/auth.js", () => ({
  resolveClientApiKey: async () => ({ apiKey: state.key, auth: { ok: true, apiKeyId: state.keyId } }),
  getProviderCredentialsWithQuotaPreflight: vi.fn(async (_provider, excluded, _model, options) => ({ apiKey: "provider-secret", connectionId: options.strictConnectionId || (excluded?.size ? "account-b" : "account-a") })),
  markAccountUnavailable: async (_id, status) => ({ shouldFallback: status === 429 }),
}));
vi.mock("@/sse/services/model.js", () => ({
  getModelInfo: async (value) => { const [provider, ...model] = value.split("/"); return { provider, model: model.join("/") }; },
}));
vi.mock("@/sse/services/mediaRoutes.js", () => ({ wantsDefaultRoute: () => false }));
vi.mock("@/sse/services/apiKeyPolicy.js", async (original) => ({
  ...await original(),
  enforceApiKeyModelPolicy: async () => state.denied ? new Response("Denied", { status: 403 }) : null,
}));
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: (...args) => fetch(...args) }));

let directory, previousDataDir, previousEngine, listeners, adapter, generate, poll;
const signals = ["beforeExit", "SIGINT", "SIGTERM", "exit"];
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const request = (model = "suno/chirp-v4", extra = {}) => new Request("http://localhost/v1/music/generations", { method: "POST", body: JSON.stringify({ model, prompt: "music", ...extra }) });
const get = (id = "clip-1", connection = "account-a") => poll(new Request(`http://localhost/v1/music/generations/${id}`, { headers: { "x-9router-connection-id": connection } }), { params: Promise.resolve({ request_id: id }) });
const clip = (status = "complete", id = "clip-1") => ({ id, status, audio_url: "https://cdn.invalid/song.mp3", metadata: { duration: 12.5 } });
const rows = () => adapter.all("SELECT * FROM usageHistory");
const meta = (row) => JSON.parse(row.meta);

beforeEach(async () => {
  listeners = new Map(signals.map((signal) => [signal, new Set(process.listeners(signal))]));
  previousDataDir = process.env.DATA_DIR;
  previousEngine = process.env.DURINDOOR_DATABASE_ENGINE;
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "music-usage-"));
  process.env.DATA_DIR = directory;
  process.env.DURINDOOR_DATABASE_ENGINE = "sqlite";
  delete global._dbAdapter;
  vi.resetModules();
  vi.clearAllMocks();
  Object.assign(state, { key: "music-key", keyId: "music-key-id", provider: "suno", allowed: [], denied: false, failLedger: false });
  vi.stubGlobal("fetch", vi.fn());
  adapter = await (await import("@/lib/db/driver.js")).getAdapter();
  adapter.run("INSERT INTO apiKeys(id, key, name, isActive, allowedCombos, createdAt) VALUES(?, ?, ?, 1, '[]', ?)", [state.keyId, state.key, "Music test", new Date().toISOString()]);
  ({ handleMusicGeneration: generate } = await import("@/sse/handlers/music.js"));
  ({ GET: poll } = await import("@/app/api/v1/music/generations/[request_id]/route.js"));
});
afterEach(async () => {
  await global._dbAdapter?.instance?.close?.();
  delete global._dbAdapter;
  vi.unstubAllGlobals();
  for (const signal of signals) for (const listener of process.listeners(signal)) if (!listeners.get(signal).has(listener)) process.removeListener(signal, listener);
  if (previousDataDir === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = previousDataDir;
  if (previousEngine === undefined) delete process.env.DURINDOOR_DATABASE_ENGINE; else process.env.DURINDOOR_DATABASE_ENGINE = previousEngine;
  fs.rmSync(directory, { recursive: true, force: true });
});

describe("music terminal usage lifecycle", () => {
  it.each(["minimax", "minimax-cn"])("records %s synchronous terminal duration without inventing tokens or free pricing", async (provider) => {
    fetch.mockResolvedValue(json({ data: { audio: "00ff0180", status: 2 }, extra_info: { music_duration: 25364 }, base_resp: { status_code: 0 } }));
    const response = await generate(request(`${provider}/music-3.0`));
    expect(await response.json()).toMatchObject({ status: "completed", data: [{ b64_json: "AP8BgA==" }] });
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ apiKey: state.key, provider, model: "music-3.0", connectionId: "account-a", endpoint: "/v1/music/generations", cost: null, promptTokens: 0, completionTokens: 0, usageEventId: `${response.headers.get("x-request-id")}:music` });
    expect(meta(rows()[0])).toMatchObject({ modality: "music", nativeUnits: { audioSeconds: 25.364 }, costStatus: "unknown", costSource: "unavailable" });
  });

  it("retains explicit provider USD provenance", async () => {
    fetch.mockResolvedValue(json({ data: { audio: "0001", status: 2 }, usage: { input_tokens: 3, output_tokens: 7, cost_usd: 0.12 }, base_resp: { status_code: 0 } }));
    await generate(request("minimax/music-3.0"));
    expect(rows()[0]).toMatchObject({ cost: 0.12, promptTokens: 3, completionTokens: 7 });
    expect(meta(rows()[0])).toMatchObject({ costStatus: "known", costSource: "provider" });
  });

  it.each([1, undefined])("does not charge MiniMax status %s even with playable audio", async (status) => {
    fetch.mockResolvedValue(json({ data: { audio: "0001", status }, base_resp: { status_code: 0 } }));
    expect((await generate(request("minimax/music-3.0"))).status).toBe(200);
    expect(rows()).toEqual([]);
  });

  it("preserves binary bytes and records only after successful stream completion", async () => {
    const bytes = new Uint8Array([0, 255, 1, 128]);
    fetch.mockResolvedValue(new Response(bytes, { headers: { "content-type": "audio/mpeg" } }));
    const response = await generate(request("minimax/music-3.0"));
    expect(response.bodyUsed).toBe(false);
    expect(rows()).toEqual([]);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(rows()).toHaveLength(1);
    expect(rows()[0].cost).toBeNull();
  });

  it.each([false, true])("requires a MiniMax SSE terminal, terminal=%s", async (terminal) => {
    const wire = `data: ${JSON.stringify({ data: { status: terminal ? 2 : 1, audio: "0001" }, extra_info: { music_duration: 1000 }, base_resp: { status_code: 0 } })}\n\n`;
    fetch.mockResolvedValue(new Response(wire, { headers: { "content-type": "text/event-stream" } }));
    const response = await generate(request("minimax/music-3.0", { stream: true }));
    expect(rows()).toEqual([]);
    expect(await response.text()).toBe(wire);
    expect(rows()).toHaveLength(terminal ? 1 : 0);
  });

  it("leaves interrupted binary output uncharged", async () => {
    fetch.mockResolvedValue(new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1])); controller.error(new Error("disconnected")); } }), { headers: { "content-type": "audio/mpeg" } }));
    const response = await generate(request("minimax/music-3.0"));
    await expect(response.arrayBuffer()).rejects.toThrow("disconnected");
    expect(rows()).toEqual([]);
  });

  it("counts Suno completion once, never submission or playable streaming URLs", async () => {
    fetch.mockResolvedValueOnce(json({ clips: [clip("submitted")] }))
      .mockResolvedValueOnce(json({ clips: [clip("streaming")] }))
      .mockResolvedValueOnce(json({ clips: [clip()] }));
    const submitted = await generate(request());
    expect(await submitted.json()).toMatchObject({ request_id: "clip-1", status: "submitted" });
    expect(submitted.headers.get("x-9router-connection-id")).toBe("account-a");
    expect(rows()).toEqual([]);
    expect((await get()).status).toBe(200);
    expect(rows()).toEqual([]);
    const completed = await get();
    expect(await completed.json()).toMatchObject({ status: "completed" });
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ usageEventId: `${submitted.headers.get("x-request-id")}:music`, connectionId: "account-a", cost: null });
    expect(meta(rows()[0])).toMatchObject({ nativeUnits: { audioSeconds: 12.5 } });
    expect(String(fetch.mock.calls[1][0])).toContain("/api/feed/v2?ids=clip-1");
    expect(fetch.mock.calls[1][1].method).toBe("GET");
    expect((await get()).status).toBe(200);
    expect(rows()).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("tracks Udio submission IDs and requires every returned song to finish", async () => {
    state.provider = "udio";
    fetch.mockResolvedValueOnce(json({ track_ids: ["b", "a"] }))
      .mockResolvedValueOnce(json({ songs: [{ id: "a", finished: true, song_path: "https://cdn.invalid/a" }, { id: "b", finished: false }] }))
      .mockResolvedValueOnce(json({ songs: [{ id: "b", finished: true, song_path: "https://cdn.invalid/b" }, { id: "a", finished: true, song_path: "https://cdn.invalid/a" }] }));
    expect(await (await generate(request("udio/udio-default"))).json()).toMatchObject({ request_id: "a,b", status: "submitted" });
    await get("a,b");
    expect(rows()).toEqual([]);
    expect(await (await get("a,b")).json()).toMatchObject({ status: "completed" });
    expect(rows()).toHaveLength(1);
    expect(meta(rows()[0])).toMatchObject({ nativeUnits: {}, costStatus: "unknown" });
    expect(new URL(fetch.mock.calls[1][0]).searchParams.get("songIds")).toBe("a,b");
  });

  it("rejects cross-key and cross-connection polls before provider access", async () => {
    fetch.mockResolvedValueOnce(json({ clips: [clip("submitted")] }));
    await generate(request());
    state.keyId = "other-key-id"; state.key = "other-key";
    expect((await get()).status).toBe(404);
    state.keyId = "music-key-id"; state.key = "music-key";
    expect((await get("clip-1", "account-b")).status).toBe(404);
    state.allowed = ["account-b"];
    expect((await get()).status).toBe(403);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(rows()).toEqual([]);
  });

  it("retries persisted terminal evidence after ledger failure without polling again", async () => {
    fetch.mockResolvedValueOnce(json({ clips: [clip("submitted")] })).mockResolvedValueOnce(json({ clips: [clip()] }));
    await generate(request());
    state.failLedger = true;
    expect((await get()).status).toBe(500);
    expect(rows()).toEqual([]);
    state.failLedger = false;
    expect((await get()).status).toBe(200);
    expect((await get()).status).toBe(200);
    expect(rows()).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("never charges failed jobs and replays their terminal failure", async () => {
    fetch.mockResolvedValueOnce(json({ clips: [clip("submitted")] })).mockResolvedValueOnce(json({ clips: [clip("error")] }));
    await generate(request());
    expect(await (await get()).json()).toMatchObject({ status: "failed" });
    expect(await (await get()).json()).toMatchObject({ status: "failed" });
    expect(rows()).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("rejects mismatched provider results without finishing the owned job", async () => {
    fetch.mockResolvedValueOnce(json({ clips: [clip("submitted")] })).mockResolvedValueOnce(json({ clips: [clip("complete", "other")] }));
    await generate(request());
    expect((await get()).status).toBe(502);
    expect(rows()).toEqual([]);
  });

  it("rejects anonymous submissions and policy denials before transport", async () => {
    state.keyId = null; state.key = null;
    expect((await generate(request())).status).toBe(403);
    state.keyId = "music-key-id"; state.key = "music-key"; state.denied = true;
    expect((await generate(request())).status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps the legacy video namespace independent from music", async () => {
    const { createMediaJob, getMediaJob, finishMediaJob } = await import("@/lib/db/repos/mediaJobsRepo.js");
    const identity = { provider: "suno", connectionId: "account-a", resourceId: "clip-1" };
    const fields = { ...identity, apiKeyId: state.keyId, model: "chirp-v4", endpoint: "/v1/videos/generations", usageEventId: "video-event" };
    const video = await createMediaJob(fields);
    expect(video.modality).toBeUndefined();
    await createMediaJob({ ...fields, modality: "music", endpoint: "/v1/music/generations", usageEventId: "music-event" });
    await finishMediaJob(video, state.keyId, { status: "failed" });
    expect((await getMediaJob(identity, state.keyId)).terminal.status).toBe("failed");
    expect((await getMediaJob({ ...identity, modality: "music" }, state.keyId)).terminal).toBeUndefined();
    expect(await getMediaJob({ ...identity, modality: "music" }, "other-key")).toBeNull();
  });
});

it("keeps concurrent completion polls idempotent", async () => {
  fetch.mockResolvedValueOnce(json({ clips: [clip("submitted")] }));
  await generate(request());
  fetch.mockImplementation(async () => json({ clips: [clip()] }));
  const responses = await Promise.all([get(), get()]);
  expect(responses.map((response) => response.status)).toEqual([200, 200]);
  expect(rows()).toHaveLength(1);
});

it("records only the successful fallback account", async () => {
  fetch.mockResolvedValueOnce(json({ message: "quota" }, 429))
    .mockResolvedValueOnce(json({ data: { audio: "0001", status: 2 }, base_resp: { status_code: 0 } }));
  const response = await generate(request("minimax/music-3.0"));
  expect(response.status).toBe(200);
  expect(rows()).toHaveLength(1);
  expect(rows()[0]).toMatchObject({ connectionId: "account-b", usageEventId: `${response.headers.get("x-request-id")}:music` });
});

it("does not bill even a completed asynchronous submission snapshot", async () => {
  fetch.mockResolvedValueOnce(json({ clips: [clip()] }));
  expect((await generate(request())).status).toBe(200);
  expect(rows()).toEqual([]);
});
