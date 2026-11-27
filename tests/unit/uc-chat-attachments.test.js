// Synthetic source-shaped uploads and sockets only. No provider/account calls.
import { describe, it, expect, vi } from "vitest";
import "../translator/registerAll.js";
import { createUcAttachmentChatExecutor } from "../../open-sse/services/providerParity/native-uc-chat/index.js";
import { extractUcAttachment, uploadUcAttachment, validateUcUploadUrl, UC_ATTACHMENT_MAX_BYTES } from "../../open-sse/services/providerParity/native-uc-chat/attachments.js";
import { createOutboundUrlLookup } from "../../open-sse/utils/outboundUrlGuard.js";
import { createUcSessionController } from "../../open-sse/services/providerParity/native-uc-signin/session.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const ENV = { DURINDOOR_UC_CONSUMER_SIGNIN: "1" };
const A = "0a1b2c3d-0000-4000-8000-00000000000a";
const B = "0a1b2c3d-0000-4000-8000-00000000000b";
const credentials = (uid = A) => ({ connectionId: uid, providerSpecificData: {
  ucUid: uid, ucSid: `sess_${uid.replaceAll("-", "")}`, ucClientCookie: `SYNTHETIC-client-${uid}`, ucCookies: { __client: `SYNTHETIC-client-${uid}` },
  ucAuthSource: "cookie-import", ucSignedInAt: "2026-11-01T00:00:00.000Z",
} });
const data = "data:image/png;base64,aGVsbG8=";
const image = { type: "image_url", image_url: { url: data } };
const file = { type: "file", file: { filename: "sample.pdf", file_data: "data:application/pdf;base64,cGRm" } };
const messages = (part = image) => [{ role: "user", content: [{ type: "text", text: "inspect this" }, part] }];
const response = (value, status = 200) => new Response(JSON.stringify(value), { status });

function fixture(options = {}) {
  const frames = [];
  const urls = [];
  const sockets = [];
  const upload = vi.fn(async (url, init) => {
    urls.push({ url, init });
    if (init.method === "POST") return response({ signed_url: "https://d.moveinwater.com/up/SYNTHETIC", blob_name: `blob-${JSON.parse(init.body).user_identifier}` });
    return new Response(null, { status: 204 });
  });
  const session = { getSessionToken: vi.fn(async () => ({ ok: true, jwt: "SYNTHETIC-jwt" })), forget: vi.fn() };
  class Socket {
    constructor(url, init) { sockets.push({ url, init }); queueMicrotask(() => this.onopen()); }
    on() {}
    send(raw) {
      frames.push(JSON.parse(raw));
      options.onSend?.();
      queueMicrotask(() => options.truncate ? this.onclose({ code: 1006 }) : this.onmessage({ data: JSON.stringify({ message_type: "text", end_of_stream: true, raw_text: "attachment understood" }) }));
    }
    close() {}
    terminate() {}
  }
  const ex = createUcAttachmentChatExecutor({ env: ENV, sessionController: session, WebSocketImpl: Socket, uploadFetchImpl: upload, ...options });
  const run = (input = {}) => ex.execute({ model: "claude-opus-47", credentials: credentials(), body: { messages: messages() }, stream: false, ...input });
  return { ex, run, upload, session, frames, urls, sockets };
}

describe("source persona attachment flow", () => {
  it.each([image, file])("POSTs then PUTs then sends one blob reference", async (part) => {
    const f = fixture();
    const attempt = vi.fn();
    const result = await f.run({ body: { messages: messages(part) }, onProviderAttempt: attempt });
    expect(result.response.status).toBe(200);
    expect((await result.response.json()).choices[0].message.content).toBe("attachment understood");
    expect(f.urls).toHaveLength(2);
    const [{ url, init }, put] = f.urls;
    expect(url).toBe("https://internal-6.pubyar.com/generate-signed-url");
    expect(init.headers).toEqual({ Authorization: "Bearer SYNTHETIC-jwt", "Content-Type": "application/json", Origin: "https://uncensored.com", Referer: "https://uncensored.com/" });
    expect(JSON.parse(init.body)).toEqual({ content_type: part === image ? "image/png" : "application/pdf", user_identifier: A });
    expect(init.redirect).toBe("manual");
    expect(put.init.headers).toEqual({ "Content-Type": part === image ? "image/png" : "application/pdf" });
    expect(Buffer.from(put.init.body).toString()).toBe(part === image ? "hello" : "pdf");
    expect(f.frames).toHaveLength(1);
    expect(f.frames[0]).toMatchObject({ media_blob_name: `blob-${A}`, media_content_type: part === image ? "image/png" : "application/pdf", no_media_in_chat: true });
    expect(f.sockets[0].init.headers).toEqual({ Origin: "https://uncensored.com" });
    expect(result.acceptedUpload).toEqual({ state: "accepted", outcome: "uploaded" });
    expect(JSON.stringify(result.transformedBody)).not.toContain("SYNTHETIC-jwt");
  });

  it("uses actual Anthropic image and document request translation", async () => {
    for (const block of [
      { type: "image", source: { type: "base64", media_type: "image/png", data: "aGVsbG8=" } },
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: "cGRm" } },
    ]) {
      const body = translateRequest(FORMATS.CLAUDE, FORMATS.OPENAI, "claude-opus-47", { messages: [{ role: "user", content: [{ type: "text", text: "inspect this" }, block] }] }, false, {});
      const f = fixture();
      expect((await f.run({ body })).response.status).toBe(200);
      expect(f.frames[0].media_blob_name).toBe(`blob-${A}`);
    }
  });

  it("uses actual OpenAI identity translation and supports streaming", async () => {
    const body = translateRequest(FORMATS.OPENAI, FORMATS.OPENAI, "claude-opus-47", { messages: messages() }, true, {});
    const f = fixture();
    const result = await f.run({ body, stream: true });
    const text = await result.response.text();
    expect(text).toContain("attachment understood");
    expect(text).toContain("[DONE]");
  });

  it("never reuses another account's blob or socket", async () => {
    const f = fixture();
    await Promise.all([f.run(), f.run({ credentials: credentials(B) })]);
    expect(f.frames.map((v) => [v.user_identifier, v.media_blob_name]).sort()).toEqual([[A, `blob-${A}`], [B, `blob-${B}`]]);
    expect(f.sockets).toHaveLength(2);
    expect(f.session.getSessionToken.mock.calls.map(([c]) => c.connectionId).sort()).toEqual([A, A, B, B]);
  });

  it("reuses only account-scoped tokens and refreshes after upload with rotation persisted", async () => {
    let clock = 1_800_000_000_000;
    const counts = {};
    const minted = [];
    const b64 = (x) => Buffer.from(JSON.stringify(x)).toString("base64url");
    const session = createUcSessionController({ env: ENV, now: () => clock, refreshSkewMs: 8000,
      fetchImpl: async (url, init) => {
        const uid = url.includes(A.replaceAll("-", "")) ? A : B;
        counts[uid] = (counts[uid] ?? 0) + 1;
        expect(init.headers.Cookie).toContain(`SYNTHETIC-client-${uid}`);
        expect(init.headers.Cookie).not.toContain(`SYNTHETIC-client-${uid === A ? B : A}`);
        const jwt = `${b64({ alg: "RS256" })}.${b64({ uid, exp: clock / 1000 + 60 })}.SYNTHETICsig`;
        minted.push({ uid, jwt });
        return new Response(JSON.stringify({ jwt }), { headers: counts[uid] === 2 ? { "Set-Cookie": `__client=SYNTHETIC-rotated-${uid}; Path=/` } : {} });
      },
    });
    const upload = vi.fn(async (_url, init) => {
      if (init.method === "POST") return response({ signed_url: "https://d.moveinwater.com/up/x", blob_name: `blob-${JSON.parse(init.body).user_identifier}` });
      clock += 55_000;
      return new Response(null, { status: 204 });
    });
    const persist = vi.fn();
    const f = fixture({ sessionController: session, uploadFetchImpl: upload });
    expect((await f.run({ onCredentialsRefreshed: persist })).response.status).toBe(200);
    expect(counts[A]).toBe(2);
    expect(upload).toHaveBeenCalledTimes(2);
    expect(new URL(f.sockets[0].url).searchParams.get("token")).toBe(minted[1].jwt);
    expect(persist.mock.calls[0][0].providerSpecificData.ucClientCookie).toBe(`SYNTHETIC-rotated-${A}`);
    expect(persist.mock.calls[0][0].connectionId).toBe(A);
    expect((await f.run({ credentials: credentials(B) })).response.status).toBe(200);
    expect(counts[B]).toBe(2);
    expect(f.frames[1].user_identifier).toBe(B);
  });

  it("does not upload when connection routing cannot be honored", async () => {
    const f = fixture();
    expect((await f.run({ proxyOptions: { strictProxy: true } })).response.status).toBe(400);
    expect(f.upload).not.toHaveBeenCalled();
    expect(f.session.getSessionToken).not.toHaveBeenCalled();
  });

  it("never repeats the upload when socket-token refresh fails", async () => {
    const f = fixture();
    f.session.getSessionToken.mockResolvedValueOnce({ ok: true, jwt: "SYNTHETIC-jwt" }).mockResolvedValueOnce({ ok: false, kind: "reauth" });
    const result = await f.run();
    expect(result.response.status).toBe(401);
    expect(result.acceptedUpload.state).toBe("accepted");
    expect(f.frames).toHaveLength(0);
    expect(f.upload).toHaveBeenCalledTimes(2);
  });

  it("retains upload and turn state on abort after socket dispatch", async () => {
    const controller = new AbortController();
    const f = fixture({ onSend: () => queueMicrotask(() => controller.abort()) });
    const result = await f.run({ signal: controller.signal });
    expect(result.response.status).toBe(499);
    expect(result.acceptedUpload.state).toBe("accepted");
    expect(result.acceptedTurn).toEqual({ state: "uncertain", outcome: "aborted" });
    expect(f.upload).toHaveBeenCalledTimes(2);
    expect(f.frames).toHaveLength(1);
  });

  it("retains accepted upload and uncertain turn without replay", async () => {
    const f = fixture({ truncate: true });
    const result = await f.run();
    expect(result.response.status).toBe(502);
    expect(result.acceptedUpload.state).toBe("accepted");
    expect(result.acceptedTurn.state).toBe("uncertain");
    expect(f.upload).toHaveBeenCalledTimes(2);
    expect(f.frames).toHaveLength(1);
  });
});

const badParts = [
  { type: "input_audio", input_audio: { data: "aGVsbG8=", format: "wav" } },
  { type: "image_url", image_url: { url: "https://example.com/image.png" } },
  { type: "image_url", image_url: { url: "http://127.0.0.1/x" } },
  { type: "file", file: { file_id: "file-synthetic" } },
  { type: "file", file: { filename: "x.wav", file_data: "aGVsbG8=" } },
  { type: "image_url", image_url: { url: "data:text/html;base64,aGVsbG8=" } },
  { type: "image_url", image_url: { url: "data:image/png;base64,!!!!" } },
  { type: "image_url", image_url: { url: "data:image/png;base64,aB==" } },
  { type: "image_url", image_url: { url: "data:image/png;base64," } },
  { type: "document", source: { type: "url", url: "https://example.com/a.pdf" } },
];
describe("local admission", () => {
  it.each(badParts)("rejects unsupported/malformed inputs before mint, upload and billing", async (part) => {
    const f = fixture(); const billing = vi.fn();
    expect((await f.run({ body: { messages: messages(part) }, onProviderAttempt: billing })).response.status).toBe(400);
    expect(f.session.getSessionToken).not.toHaveBeenCalled();
    expect(f.upload).not.toHaveBeenCalled();
    expect(billing).not.toHaveBeenCalled();
    expect(f.frames).toHaveLength(0);
  });
  it("bounds attachment count and bytes", async () => {
    const f = fixture();
    for (const content of [[image, file], [{ type: "image_url", image_url: { url: `data:image/png;base64,${Buffer.alloc(UC_ATTACHMENT_MAX_BYTES + 1).toString("base64")}` } }]]) {
      expect((await f.run({ body: { messages: [{ role: "user", content }] } })).response.status).toBe(400);
    }
    expect(f.upload).not.toHaveBeenCalled();
  });
  it("does not upload historical media again", () => {
    expect(extractUcAttachment([...messages(), { role: "assistant", content: "old answer" }, { role: "user", content: "next" }])).toBeNull();
  });
  it("does not drop media in an earlier active user message", () => {
    expect(() => extractUcAttachment([...messages(), { role: "user", content: "next" }])).toThrow();
  });
  it.each([{ env: {} }, { model: "not-a-model" }, { credentials: { apiKey: "synthetic" } }])("does not upload disabled, refused-model or unsigned requests", async (change) => {
    const f = fixture(change.env ? { env: change.env } : {});
    expect((await f.run(change)).response.status).toBeGreaterThanOrEqual(400);
    expect(f.upload).not.toHaveBeenCalled();
  });
  it.each(["needs_operator", "identity", "reauth"])("does not upload after %s auth failure", async (kind) => {
    const f = fixture(); f.session.getSessionToken.mockResolvedValue({ ok: false, kind });
    expect((await f.run()).response.status).toBeGreaterThanOrEqual(400);
    expect(f.upload).not.toHaveBeenCalled();
  });
});

describe("upload security and failure boundaries", () => {
  it.each([
    "http://d.moveinwater.com/up/x", "https://evil.example/up/x", "https://d.moveinwater.com.evil.example/up/x", "https://user:secret@d.moveinwater.com/up/x", "https://d.moveinwater.com:8443/up/x", "https://127.0.0.1/up/x", "https://[::1]/up/x", "https://d.moveinwater.com/not-upload/x", "https://d.moveinwater.com/up/x#secret",
  ])("refuses upload destination %s", (url) => expect(() => validateUcUploadUrl(url)).toThrow());

  it.each(["127.0.0.1", "10.0.0.1", "169.254.169.254", "::1", "::ffff:127.0.0.1"])("rejects DNS address %s at connection time", async (address) => {
    const lookup = createOutboundUrlLookup("public-only", (_h, _o, cb) => cb(null, [{ address, family: address.includes(":") ? 6 : 4 }]));
    await expect(new Promise((resolve, reject) => lookup("d.moveinwater.com", {}, (err, result) => err ? reject(err) : resolve(result)))).rejects.toThrow();
  });

  it.each(["post-redirect", "put-redirect", "post-status", "put-status", "invalid-url", "invalid-blob", "oversized-json", "post-throw", "put-throw"])("fails closed without socket/retry for %s", async (mode) => {
    const fetcher = vi.fn(async (_url, init) => {
      const post = init.method === "POST";
      if (mode === `${post ? "post" : "put"}-throw`) throw new Error("SYNTHETIC-jwt private upstream failure");
      if (mode === `${post ? "post" : "put"}-redirect`) return new Response(null, { status: 307, headers: { Location: "https://evil.example/" } });
      if (mode === `${post ? "post" : "put"}-status`) return new Response(null, { status: 500 });
      if (!post) return new Response(null, { status: 204 });
      if (mode === "oversized-json") return response({ x: "x".repeat(17000) });
      return response({ signed_url: mode === "invalid-url" ? "https://evil.example/up/x" : "https://d.moveinwater.com/up/x", blob_name: mode === "invalid-blob" ? "../x" : "blob-x" });
    });
    const f = fixture({ uploadFetchImpl: fetcher });
    const result = await f.run();
    expect(result.response.status).toBe(502);
    expect(await result.response.text()).not.toContain("SYNTHETIC-jwt");
    expect(result.acceptedUpload.state).toBe("uncertain");
    expect(fetcher.mock.calls.length).toBeLessThanOrEqual(2);
    expect(f.frames).toHaveLength(0);
  });

  it("bounds an uncooperative upload transport", async () => {
    const f = fixture({ uploadFetchImpl: () => new Promise(() => {}), uploadTimeoutMs: 10 });
    const result = await f.run();
    expect(result.response.status).toBe(502);
    expect(result.acceptedUpload).toEqual({ state: "uncertain", outcome: "signed-url" });
  });
  it("aborts an upload without a socket or replay", async () => {
    const controller = new AbortController();
    const f = fixture({ uploadFetchImpl: async () => { controller.abort(); return new Promise(() => {}); } });
    const result = await f.run({ signal: controller.signal });
    expect(result.response.status).toBe(499);
    expect(f.frames).toHaveLength(0);
  });
  it("aborts during PUT and records its uncertain outcome", async () => {
    const controller = new AbortController();
    const calls = [];
    const f = fixture({ uploadFetchImpl: async (_url, init) => {
      calls.push(init.method);
      if (init.method === "POST") return response({ signed_url: "https://d.moveinwater.com/up/x", blob_name: "blob-x" });
      controller.abort(); return new Promise(() => {});
    } });
    const result = await f.run({ signal: controller.signal });
    expect(result.response.status).toBe(499);
    expect(result.acceptedUpload).toEqual({ state: "uncertain", outcome: "put" });
    expect(calls).toEqual(["POST", "PUT"]);
    expect(f.frames).toHaveLength(0);
  });
  it("rejects a foreign response even if the transport followed a redirect", async () => {
    const f = fixture({ uploadFetchImpl: async () => {
      const res = response({ signed_url: "https://d.moveinwater.com/up/x", blob_name: "blob-x" });
      Object.defineProperty(res, "url", { value: "https://evil.example/" });
      return res;
    } });
    expect((await f.run()).response.status).toBe(502);
    expect(f.frames).toHaveLength(0);
  });
  it("rejects mixed public/private DNS answers and pins public results", async () => {
    for (const records of [[{ address: "8.8.8.8", family: 4 }, { address: "10.0.0.1", family: 4 }], [{ address: "8.8.8.8", family: 4 }]]) {
      const resolver = vi.fn((_h, _o, cb) => cb(null, records));
      const lookup = createOutboundUrlLookup("public-only", resolver);
      const result = new Promise((resolve, reject) => lookup("d.moveinwater.com", { all: true }, (err, value) => err ? reject(err) : resolve(value)));
      if (records.length === 2) await expect(result).rejects.toThrow();
      else await expect(result).resolves.toEqual(records);
      expect(resolver).toHaveBeenCalledTimes(1);
    }
  });
  it("never starts an already aborted upload", async () => {
    const controller = new AbortController(); controller.abort(); const fetchImpl = vi.fn();
    await expect(uploadUcAttachment({ bytes: Buffer.from("x"), contentType: "text/plain" }, { jwt: "synthetic", uid: A, signal: controller.signal, fetchImpl, onState: () => {} })).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
