// Codex OAuth speech-to-text (#1563, upstream 9router 421f2262).
// Unverified: ChatGPT's /backend-api/transcribe was never called; ffmpeg and the upstream are mocked.
import { EventEmitter } from "node:events";
import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { beforeEach, describe, expect, it, vi } from "vitest";

const spawnMode = vi.hoisted(() => ({ mode: "ok", pcmBytes: 48000, args: null }));
vi.mock("node:child_process", () => ({
  spawn: (_cmd, args) => {
    spawnMode.args = args;
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.kill = vi.fn();
    setImmediate(() => {
      if (spawnMode.mode === "missing") return child.emit("error", Object.assign(new Error("spawn ffmpeg ENOENT"), { code: "ENOENT" }));
      if (spawnMode.mode === "ok") child.stdout.emit("data", Buffer.alloc(spawnMode.pcmBytes));
      return child.emit("close", spawnMode.mode === "bad" ? 1 : 0);
    });
    return child;
  },
}));
const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: (...a) => fetchMock(...a) }));

const { transcribeCodex } = await import("../../open-sse/handlers/codexStt.js");
const { FFMPEG_MISSING_MESSAGE } = await import("../../open-sse/handlers/codexSttAudio.js");
const { handleSttCore } = await import("../../open-sse/handlers/sttCore.js");
const { default: codex } = await import("../../open-sse/providers/registry/codex.js");

const credentials = { authType: "oauth", accessToken: "access-token", providerSpecificData: { chatgptAccountId: "acct-1" } };
const form = (extra = {}) => {
  const fd = new FormData();
  fd.append("model", "transcribe");
  fd.append("file", new File(["audio"], "clip.mp3", { type: "audio/mpeg" }));
  for (const [k, v] of Object.entries(extra)) fd.append(k, v);
  return fd;
};
const tempDirs = () => readdirSync(tmpdir()).filter((n) => n.startsWith("durindoor-codex-stt-")).length;
const upstreamOk = (text = "hello") => new Response(JSON.stringify({ text }), { status: 200 });

beforeEach(() => { spawnMode.mode = "ok"; spawnMode.pcmBytes = 48000; fetchMock.mockReset(); });

describe("codex registry", () => {
  it("exposes cx/transcribe as an OAuth stt model", () => {
    expect(codex.serviceKinds).toContain("stt");
    expect(codex.sttConfig).toMatchObject({ baseUrl: "https://chatgpt.com/backend-api/transcribe", authType: "oauth", format: "codex-transcribe" });
    expect(codex.models.find((m) => m.id === "transcribe")).toMatchObject({ kind: "stt", responseFormats: ["json", "text"] });
  });
});

describe("transcribeCodex", () => {
  it("converts with ffmpeg, posts WAV with Codex identity headers and reports decoded seconds", async () => {
    fetchMock.mockResolvedValueOnce(upstreamOk("hello world"));
    const before = tempDirs();
    const result = await transcribeCodex({ formData: form(), credentials });
    expect(result.success).toBe(true);
    expect(await result.response.json()).toEqual({ text: "hello world" });
    expect(result.nativeUnits).toEqual({ audioSeconds: 1 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://chatgpt.com/backend-api/transcribe");
    expect(init.headers.Authorization).toBe("Bearer access-token");
    expect(init.headers["ChatGPT-Account-Id"]).toBe("acct-1");
    expect(init.body.toString("latin1")).toContain('filename="audio.wav"');
    expect(init.body.includes(Buffer.from("RIFF"))).toBe(true);
    expect(init.redirect).toBe("error");
    expect(spawnMode.args).toEqual(expect.arrayContaining(["-protocol_whitelist", "file,pipe", "-ar", "24000", "-ac", "1"]));
    expect(tempDirs()).toBe(before); // private temp input removed
  });

  it("returns text/plain for response_format=text", async () => {
    fetchMock.mockResolvedValueOnce(upstreamOk("plain"));
    const result = await transcribeCodex({ formData: form({ response_format: "text" }), credentials });
    expect(result.response.headers.get("content-type")).toContain("text/plain");
    expect(await result.response.text()).toBe("plain");
  });

  it("returns a clear local 503 when ffmpeg is missing, without calling upstream or leaking temp files", async () => {
    spawnMode.mode = "missing";
    const before = tempDirs();
    const result = await transcribeCodex({ formData: form(), credentials });
    expect(result.success).toBeFalsy();
    expect(result.status).toBe(503);
    expect(result.local).toBe(true);
    expect(FFMPEG_MISSING_MESSAGE).toMatch(/ffmpeg/);
    expect(JSON.stringify(await result.response.json())).toContain("ffmpeg is required");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(tempDirs()).toBe(before);
  });

  it.each([
    ["unsupported field", { language: "en" }, 400],
    ["unsupported format", { response_format: "srt" }, 400],
  ])("rejects %s locally", async (_label, extra, status) => {
    const result = await transcribeCodex({ formData: form(extra), credentials });
    expect(result.status).toBe(status);
    expect(result.local).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects audio that decodes longer than 120 seconds and undecodable audio as local 400s", async () => {
    spawnMode.pcmBytes = 120 * 24000 * 2 + 2;
    const tooLong = await transcribeCodex({ formData: form(), credentials });
    expect([tooLong.status, tooLong.local]).toEqual([400, true]);
    spawnMode.mode = "bad";
    const bad = await transcribeCodex({ formData: form(), credentials });
    expect([bad.status, bad.local]).toEqual([400, true]);
  });

  it("treats a missing OAuth account as an account fault and an upstream 403 as non-local", async () => {
    const noAccount = await transcribeCodex({ formData: form(), credentials: { ...credentials, providerSpecificData: {} } });
    expect([noAccount.status, noAccount.local]).toEqual([401, undefined]);
    fetchMock.mockResolvedValueOnce(new Response("denied", { status: 403 }));
    const denied = await transcribeCodex({ formData: form(), credentials });
    expect([denied.status, denied.local]).toEqual([403, undefined]);
  });

  it("rejects malformed upstream bodies with 502", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ nope: 1 }), { status: 200 }));
    expect((await transcribeCodex({ formData: form(), credentials })).status).toBe(502);
  });
});

describe("handleSttCore dispatch", () => {
  it("routes the codex-transcribe format and refuses translations", async () => {
    fetchMock.mockResolvedValueOnce(upstreamOk("ok"));
    const ok = await handleSttCore({ provider: "codex", model: "transcribe", formData: form(), credentials, sttConfig: codex.sttConfig });
    expect(ok.success).toBe(true);
    const translated = await handleSttCore({ provider: "codex", model: "transcribe", formData: form(), credentials, sttConfig: codex.sttConfig, kind: "translation" });
    expect(translated.status).toBe(400);
  });
});
