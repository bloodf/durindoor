// SYNTX.ai native media adapters, staged and unregistered (#1234, #2034).
// Closed mocks only: every request is answered below, an unexpected request
// fails the test, every JWT is synthetic and DNS answers are injected. Wire
// shapes follow OmniRoute c71f0065 (services/syntxAuth.ts, syntxMedia.ts,
// syntxMediaCatalog.ts, handlers/syntxAudio.ts, imageGeneration/providers/
// syntx.ts, videoGeneration/syntxHandler.ts). Passing here says nothing about
// the live service.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import * as staged from "../../open-sse/services/providerParity/native-syntx-media/index.js";
import {
  SYNTX_MEDIA_MODELS,
  applySyntxProviderRules,
  collectSyntxCompletedMedia,
  createSyntxImageAdapter,
  createSyntxMusicAdapter,
  createSyntxSttAdapter,
  createSyntxTtsAdapter,
  createSyntxVideoAdapter,
  decodeSyntxDataUrl,
  downloadSyntxMedia,
  mapSyntxImageSettings,
  mapSyntxVideoSettings,
  resolveSyntxCredential,
  resolveSyntxModel,
  sniffAudioFormat,
  syntxPollTimeout,
  syntxPublicUrl,
  syntxTranscriptText,
} from "../../open-sse/services/providerParity/native-syntx-media/index.js";
import { getImageAdapter } from "../../open-sse/handlers/imageProviders/index.js";
import { getVideoGenerationAdapter } from "../../open-sse/handlers/videoProviders/index.js";
import { getTtsAdapter } from "../../open-sse/handlers/ttsProviders/index.js";

const ORIGIN = "https://api.syntx.ai";
const CHATS = `${ORIGIN}/api/v1/chats`;
const UPLOAD = `${ORIGIN}/api/v1/chats/upload-files`;
const TRANSCRIBE = `${ORIGIN}/api/v1/audio/transcribe`;
const JWT_A = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJTWU5USEVUSUMtYSJ9.U1lOVEhFVElDLXNpZy1h";
const JWT_B = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJTWU5USEVUSUMtYiJ9.U1lOVEhFVElDLXNpZy1i";
const CREDS = { apiKey: JWT_A };
const PROMPT = "a red ball rolling on a white floor";
const CHAT = "chat-0001";
const IMG_A = "https://r2.syntx.ai/out/image-a.png";
const IMG_B = "https://r2.syntx.ai/out/image-b.png";
const VIDEO = "https://r2.syntx.ai/out/video.mp4";
const AUDIO = "https://r2.syntx.ai/out/audio.mp3";
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const MP3 = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(16, 1)]);
const WAV = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVE"), Buffer.alloc(8)]);
const DATA_PNG = `data:image/png;base64,${PNG.toString("base64")}`;
const REGISTRATION = JSON.parse(readFileSync(new URL(
  "../../open-sse/services/providerParity/native-syntx-media/registration.json", import.meta.url), "utf8"));

const json = (value, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
const withUrl = (response, url) => Object.defineProperty(response, "url", { value: url });
const chatCreated = (uuid = CHAT) => json({ uuid });
const accepted = (extra = {}) => json({ ok: true, ...extra });
const message = (objects, author = -1) => ({ author_id: author, message_object: objects });
const messages = (...list) => json({ messages: [message([{ object_type: "text", object_text: PROMPT, completed: true }], 7), ...list] });
const done = (urls, type = "image") => messages(message(urls.map((url) => ({ object_type: type, object_url: url, completed: true }))));
const pending = () => messages(message([{ object_type: "image", object_url: "", completed: false }]));
const leaky = (status) => json({ detail: `upstream echo ${JWT_A} ${PROMPT}` }, status);
const transportError = (code) => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(`connect ${JWT_A}`), { code }) });
const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];

/**
 * A closed API mock plus a closed download mock. `steps` answer API calls in
 * order; `downloads` maps URL → Response or function.
 */
function harness(steps, { downloads = {}, lookup = publicLookup } = {}) {
  const calls = [];
  const downloadCalls = [];
  let clock = 0;
  const fetchImpl = async (url, init, credentials) => {
    const body = init?.body instanceof FormData ? init.body : init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ url: String(url), init, body, credentials });
    const step = steps.shift();
    if (!step) throw new Error(`Unexpected request: ${url}`);
    const answer = typeof step === "function" ? await step(String(url), init) : step;
    return answer instanceof Response && !answer.url ? withUrl(answer, String(url)) : answer;
  };
  const downloadFetch = async (url, init) => {
    downloadCalls.push({ url: String(url), init });
    const answer = downloads[String(url)];
    if (!answer) throw new Error(`Unexpected download: ${url}`);
    return typeof answer === "function" ? answer(String(url), init) : answer.clone();
  };
  const options = {
    fetchImpl,
    now: () => clock,
    wait: async (ms, signal) => {
      if (signal?.aborted) throw signal.reason;
      clock += ms;
    },
    download: { fetchImpl: downloadFetch, lookup },
  };
  return { calls, downloadCalls, options, steps, advance: (ms) => { clock += ms; } };
}

const bytesResponse = (bytes, type = "image/png") => new Response(bytes, { status: 200, headers: { "content-type": type } });
const errorText = (result) => JSON.stringify(result);
const generateCalls = (calls) => calls.filter((call) => call.url.includes("/generate?"));

describe("staging state", () => {
  it("is not registered in any production adapter table", () => {
    expect(getImageAdapter("syntx")).toBeFalsy();
    expect(getVideoGenerationAdapter("syntx")).toBeFalsy();
    expect(getTtsAdapter("syntx")).toBeFalsy();
    expect(REGISTRATION.status).toBe("staged-unregistered");
    expect(REGISTRATION.source.commit).toBe("c71f0065a7efe9230ec23b96a12253b050c4d7ad");
  });

  it("manifest model lists match the catalog for every kind, and upscale is handed to its owning unit", () => {
    for (const kind of ["image", "video", "speech", "music", "transcription"]) {
      expect(REGISTRATION.models[kind]).toEqual(SYNTX_MEDIA_MODELS.filter((row) => row.kind === kind).map((row) => row.id));
    }
    expect(REGISTRATION.models.upscaleOwnedElsewhere).toEqual(SYNTX_MEDIA_MODELS.filter((row) => row.kind === "upscale").map((row) => row.id));
    expect(REGISTRATION.modalities.upscale.status).toBe("owned-by-native-image-upscale");
    for (const name of Object.keys(REGISTRATION.modalities.upscale.requiredExports)) expect(staged[name]).toBeDefined();
    expect(Object.keys(staged).some((name) => /upscale/i.test(name))).toBe(false);
  });

  it("exports a default instance per supported modality", () => {
    expect(typeof staged.syntxImageAdapter.generate).toBe("function");
    expect(typeof staged.syntxImageAdapter.edit).toBe("function");
    expect(typeof staged.syntxVideoAdapter.generate).toBe("function");
    expect(typeof staged.syntxTtsAdapter.synthesize).toBe("function");
    expect(typeof staged.syntxMusicAdapter.generate).toBe("function");
    expect(typeof staged.syntxSttAdapter.transcribe).toBe("function");
  });
});

describe("auth", () => {
  it("reads only the selected connection, prefers a JWT, and accepts the source wrappers", () => {
    expect(resolveSyntxCredential({ apiKey: `Bearer ${JWT_A}` })).toBe(JWT_A);
    expect(resolveSyntxCredential({ accessToken: "not-a-jwt", apiKey: JWT_B })).toBe(JWT_B);
    expect(resolveSyntxCredential({ accessToken: JWT_A, apiKey: JWT_B })).toBe(JWT_A);
    expect(resolveSyntxCredential({ apiKey: JSON.stringify({ accessToken: JWT_B }) })).toBe(JWT_B);
    expect(resolveSyntxCredential({ providerSpecificData: { token: JWT_A } })).toBe(JWT_A);
    expect(resolveSyntxCredential({ providerSpecificData: { authorization: `Bearer ${JWT_B}` } })).toBe(JWT_B);
    expect(resolveSyntxCredential({ apiKey: `${JWT_A}\r\nx-evil: 1` })).toBeNull();
    expect(resolveSyntxCredential({ apiKey: "sk-123" })).toBeNull();
    expect(resolveSyntxCredential(null)).toBeNull();
  });

  it("refuses a missing or non-JWT credential with 401 before any request", async () => {
    const h = harness([]);
    const result = await createSyntxImageAdapter(h.options).generate({ model: "flux/flux-pro", body: { prompt: PROMPT }, credentials: { apiKey: "sk-123" } });
    expect(result.status).toBe(401);
    expect(h.calls).toHaveLength(0);
  });

  it("sends the source browser headers with the connection's JWT on every API call and passes the credentials for egress", async () => {
    const h = harness([chatCreated(), accepted(), done([IMG_A])]);
    const result = await createSyntxImageAdapter(h.options).generate({ model: "flux/flux-pro", body: { prompt: PROMPT }, credentials: CREDS });
    expect(result.success).toBe(true);
    for (const call of h.calls) {
      expect(call.init.headers.authorization).toBe(`Bearer ${JWT_A}`);
      expect(call.init.headers.origin).toBe("https://syntx.ai");
      expect(call.init.headers.referer).toBe("https://syntx.ai/");
      expect(call.init.headers["user-agent"]).toMatch(/Chrome\/149/);
      expect(call.init.redirect).toBe("manual");
      expect(call.credentials).toBe(CREDS);
      expect(new URL(call.url).origin).toBe(ORIGIN);
    }
  });
});

describe("model selection", () => {
  it("accepts exact catalog ids per kind, with optional provider prefix", () => {
    expect(resolveSyntxModel("sora-images/gpt-image-2", "image")?.modelType).toBe("gpt-image-2");
    expect(resolveSyntxModel("syntx/flux/flux-dev", "image")?.id).toBe("flux/flux-dev");
    expect(resolveSyntxModel("stx/kling/kling-2.1", "video")?.id).toBe("kling/kling-2.1");
    expect(resolveSyntxModel("transcribe", "transcription")?.id).toBe("transcribe");
  });

  it("resolves a bare id only within the requested kind and only when unambiguous", () => {
    expect(resolveSyntxModel("wan-2.7", "video")?.id).toBe("wan_video/wan-2.7");
    expect(resolveSyntxModel("wan-2.7", "image")?.id).toBe("wan_image/wan-2.7");
    expect(resolveSyntxModel("suno", "music")).toBeNull();
    expect(resolveSyntxModel("flux", "image")).toBeNull();
    expect(resolveSyntxModel("midjourney", "image")?.id).toBe("midjourney/midjourney");
  });

  it("refuses unknown, cross-kind, upscale and empty ids with no default and no passthrough", async () => {
    expect(resolveSyntxModel("flux/flux-pro", "video")).toBeNull();
    expect(resolveSyntxModel("magnific/magnific", "image")).toBeNull();
    expect(resolveSyntxModel("custom/anything", "image")).toBeNull();
    expect(resolveSyntxModel("", "image")).toBeNull();
    expect(resolveSyntxModel("constructor", "image")).toBeNull();
    const h = harness([]);
    for (const model of ["custom/anything", "", "magnific/magnific"]) {
      const result = await createSyntxImageAdapter(h.options).generate({ model, body: { prompt: PROMPT }, credentials: CREDS });
      expect(result.status).toBe(400);
    }
    expect(h.calls).toHaveLength(0);
  });
});

describe("settings mapping and provider rules (source parity)", () => {
  it("maps size to aspect_ratio or resolution and keeps quality only where the source does", () => {
    expect(mapSyntxImageSettings("flux", "flux-pro", { size: "16:9", n: 3 })).toEqual({ model_type: "flux-pro", n: 3, aspect_ratio: "16:9" });
    expect(mapSyntxImageSettings("sora-images", "gpt-image-2", { size: "1024x1024", quality: "high", n: 20 }))
      .toEqual({ model_type: "gpt-image-2", n: 8, resolution: "1024x1024", quality: "high" });
    expect(mapSyntxImageSettings("flux", "flux-pro", { quality: "high" })).toEqual({ model_type: "flux-pro", n: 1 });
    expect(mapSyntxImageSettings("seedream", "seedream-5", { quality: "4K", size: "auto" })).toEqual({ model_type: "seedream-5", n: 1, resolution: "4K" });
  });

  it("maps video fields, using video_duration for grok_video", () => {
    expect(mapSyntxVideoSettings("kling", "kling-2.1", { size: "16x9", duration: "10", resolution: "720p", seed: 7, fps: 24 }))
      .toEqual({ model_type: "kling-2.1", aspect_ratio: "16:9", duration: 10, resolution: "720p", seed: 7, fps: 24 });
    expect(mapSyntxVideoSettings("grok_video", "grok_t2v", { duration: 5 })).toEqual({ model_type: "grok_t2v", video_duration: 5 });
  });

  it("applies the SPA rules and ignores prototype names", () => {
    const grok = { aspect_ratio: "1:1" };
    applySyntxProviderRules("grok_image", grok, { modelType: "grok_i2i", fileCount: 1 });
    expect(grok).toEqual({});
    const seed = { resolution: "1K" };
    applySyntxProviderRules("seedream", seed, { modelType: "seedream-4.5" });
    expect(seed.resolution).toBe("2K");
    const sora = { quality: "high", details_quality: "x" };
    applySyntxProviderRules("sora-images", sora, { modelType: "gpt-image-1" });
    expect(sora).toEqual({});
    const suno = { audio_url: "x", continue_at: 1 };
    applySyntxProviderRules("suno", suno, { modelType: "chirp-v4" });
    expect(suno).toEqual({});
    const proto = { a: 1 };
    applySyntxProviderRules("constructor", proto, { modelType: "x" });
    applySyntxProviderRules("__proto__", proto, { modelType: "x" });
    expect(proto).toEqual({ a: 1 });
  });
});

describe("image generation", () => {
  it("creates an image chat, posts design/generate once, polls until complete, and returns URLs with usage", async () => {
    const h = harness([chatCreated(), accepted(), pending(), done([IMG_A, IMG_B])]);
    const result = await createSyntxImageAdapter(h.options).generate({
      model: "sora-images/gpt-image-2", body: { prompt: `  ${PROMPT}  `, size: "1024x1024", n: 2, quality: "high" }, credentials: CREDS,
    });
    expect(result.success).toBe(true);
    expect(await result.response.json()).toMatchObject({ data: [{ url: IMG_A }, { url: IMG_B }] });
    expect(result.accounting).toMatchObject({ modality: "image", costStatus: "unknown", nativeUnits: { images: 2 }, meta: { chatId: CHAT } });
    expect(h.calls.map((call) => `${call.init.method} ${call.url}`)).toEqual([
      `POST ${CHATS}`,
      `POST ${ORIGIN}/api/v1/design/generate?ai_name=sora-images`,
      `GET ${CHATS}/${CHAT}/messages?page_size=50`,
      `GET ${CHATS}/${CHAT}/messages?page_size=50`,
    ]);
    expect(h.calls[0].body).toEqual({ title: PROMPT, scope: "image" });
    expect(h.calls[1].body).toEqual({
      chat_uuid: CHAT, prompt: PROMPT,
      settings: { model_type: "gpt-image-2", n: 2, resolution: "1024x1024", quality: "high" },
    });
  });

  it("never returns a partially completed message", async () => {
    const partial = messages(message([
      { object_type: "image", object_url: IMG_A, completed: true },
      { object_type: "image", object_url: "", completed: false },
    ]));
    expect(collectSyntxCompletedMedia(message([{ object_type: "image", object_url: IMG_A, completed: true }, { object_type: "image", completed: false }])).ready).toBe(false);
    const h = harness([chatCreated(), accepted(), partial, done([IMG_A, IMG_B])]);
    const result = await createSyntxImageAdapter(h.options).generate({ model: "flux/flux-pro", body: { prompt: PROMPT }, credentials: CREDS });
    expect((await result.response.json()).data).toHaveLength(2);
  });

  it("downloads b64_json results without any credential and with DNS checks", async () => {
    const lookups = [];
    const h = harness([chatCreated(), accepted(), done([IMG_A])], {
      downloads: { [IMG_A]: bytesResponse(PNG) },
      lookup: async (host) => { lookups.push(host); return [{ address: "93.184.216.34", family: 4 }]; },
    });
    const result = await createSyntxImageAdapter(h.options).generate({ model: "flux/flux-pro", body: { prompt: PROMPT, response_format: "b64_json" }, credentials: CREDS });
    expect(await result.response.json()).toMatchObject({ data: [{ b64_json: PNG.toString("base64") }] });
    expect(lookups).toEqual(["r2.syntx.ai"]);
    expect(h.downloadCalls[0].init.headers).toEqual({ accept: "*/*" });
    expect(JSON.stringify(h.downloadCalls[0].init)).not.toContain(JWT_A);
  });

  it("returns no partial output when one of several b64 downloads fails", async () => {
    const h = harness([chatCreated(), accepted(), done([IMG_A, IMG_B])], {
      downloads: { [IMG_A]: bytesResponse(PNG), [IMG_B]: new Response("nope", { status: 500 }) },
    });
    const result = await createSyntxImageAdapter(h.options).generate({ model: "flux/flux-pro", body: { prompt: PROMPT, response_format: "b64_json" }, credentials: CREDS });
    expect(result.success).toBeFalsy();
    expect(result.status).toBe(502);
    expect(result.acceptedJob).toMatchObject({ costSource: "accepted-job", meta: { jobState: "accepted" } });
    expect(generateCalls(h.calls)).toHaveLength(1);
  });

  it("uploads data URL references first and passes https references through", async () => {
    const h = harness([
      json({ files: [{ url: "https://r2.syntx.ai/up/ref.png" }] }), chatCreated(), accepted(), done([IMG_A]),
    ]);
    const result = await createSyntxImageAdapter(h.options).generate({
      model: "grok_image/grok_i2i", body: { prompt: PROMPT, size: "1:1", image: [DATA_PNG], image_urls: ["https://cdn.example.com/in.png"] }, credentials: CREDS,
    });
    expect(result.success).toBe(true);
    expect(h.calls[0].url).toBe(UPLOAD);
    const form = h.calls[0].body;
    expect(form.get("destination")).toBe("uploaded");
    expect(form.get("check_duplicates")).toBe("true");
    expect(form.get("model_type")).toBe("");
    expect(Buffer.from(await form.get("files").arrayBuffer())).toEqual(PNG);
    expect(form.get("files").name).toBe("reference.png");
    // Source field order: image_url, image_urls, image, images. grok_i2i with
    // two files keeps aspect_ratio (source rule: dropped only below two).
    expect(h.calls[2].body.settings).toEqual({
      model_type: "grok_i2i", n: 1, aspect_ratio: "1:1",
      image_url: ["https://cdn.example.com/in.png", "https://r2.syntx.ai/up/ref.png"],
    });
  });

  it("refuses unsafe references, references for text-only models, and too many references before sending", async () => {
    const h = harness([]);
    const adapter = createSyntxImageAdapter(h.options);
    const cases = [
      { model: "flux/flux-pro", body: { prompt: PROMPT, image: "https://cdn.example.com/a.png" } },
      { model: "ideogram/ideogram", body: { prompt: PROMPT, image: "http://cdn.example.com/a.png" } },
      { model: "ideogram/ideogram", body: { prompt: PROMPT, image: "https://127.0.0.1/a.png" } },
      { model: "ideogram/ideogram", body: { prompt: PROMPT, image: "https://user:pw@cdn.example.com/a.png" } },
      { model: "ideogram/ideogram", body: { prompt: PROMPT, image: "file:///etc/passwd" } },
      { model: "ideogram/ideogram", body: { prompt: PROMPT, image: "data:text/plain;base64,aGVsbG8=" } },
      { model: "ideogram/ideogram", body: { prompt: PROMPT, image: ["a", "b", "c", "d", "e"].map((x) => `https://cdn.example.com/${x}.png`) } },
      { model: "flux/flux-pro", body: { prompt: "   " } },
      { model: "flux/flux-pro", body: { prompt: PROMPT, response_format: "png" } },
    ];
    for (const request of cases) {
      const result = await adapter.generate({ ...request, credentials: CREDS });
      expect(result.status).toBe(400);
    }
    expect(h.calls).toHaveLength(0);
    expect(() => decodeSyntxDataUrl(`data:image/png;base64,${"A".repeat(400)}`, 100)).toThrow(/exceeds/);
  });

  it("refuses an upload answer whose URL is not public https, without creating a chat", async () => {
    const h = harness([json({ data: { files: [{ url: "http://10.0.0.5/x.png" }] } })]);
    const result = await createSyntxImageAdapter(h.options).generate({ model: "ideogram/ideogram", body: { prompt: PROMPT, image: DATA_PNG }, credentials: CREDS });
    expect(result.status).toBe(502);
    expect(result.acceptedJob).toBeUndefined();
    expect(h.calls).toHaveLength(1);
  });

  it("falls back to immediate generate URLs only when the finished message has no media, never echoing inputs", async () => {
    const h = harness([
      chatCreated(),
      accepted({ result: { image_url: IMG_B, echo: { url: "https://cdn.example.com/in.png" } }, api: "https://api.syntx.ai/api/v1/x" }),
      messages(message([{ object_type: "text", object_text: "done", completed: true }])),
    ]);
    const result = await createSyntxImageAdapter(h.options).generate({
      model: "ideogram/ideogram", body: { prompt: PROMPT, image: "https://cdn.example.com/in.png" }, credentials: CREDS,
    });
    expect((await result.response.json()).data).toEqual([{ url: IMG_B }]);
  });

  it("fails with acceptedJob when the job completes without media or with an unsafe media URL", async () => {
    for (const final of [
      messages(message([{ object_type: "text", object_text: "sorry", completed: true }])),
      done(["http://r2.syntx.ai/x.png"]),
      done(["https://169.254.169.254/latest"]),
    ]) {
      const h = harness([chatCreated(), accepted(), final]);
      const result = await createSyntxImageAdapter(h.options).generate({ model: "flux/flux-pro", body: { prompt: PROMPT }, credentials: CREDS });
      expect(result.status).toBe(502);
      expect(result.acceptedJob?.meta.jobState).toBe("accepted");
    }
  });

  it("refuses an unusable chat id without submitting", async () => {
    const h = harness([json({ uuid: "../../admin" })]);
    const result = await createSyntxImageAdapter(h.options).generate({ model: "flux/flux-pro", body: { prompt: PROMPT }, credentials: CREDS });
    expect(result.status).toBe(502);
    expect(h.calls).toHaveLength(1);
  });
});

describe("image edits", () => {
  it("uploads multipart image files and requires at least one image", async () => {
    const h = harness([json({ files: [{ url: "https://r2.syntx.ai/up/edit.png" }] }), chatCreated(), accepted(), done([IMG_A])]);
    const form = new FormData();
    form.append("prompt", PROMPT);
    form.append("image", new File([PNG], "in.png", { type: "image/png" }));
    const result = await createSyntxImageAdapter(h.options).edit({ model: "banana/nano-banana", formData: form, credentials: CREDS });
    expect(result.success).toBe(true);
    expect(h.calls[2].body.settings.image_url).toEqual(["https://r2.syntx.ai/up/edit.png"]);

    const empty = new FormData();
    empty.append("prompt", PROMPT);
    const h2 = harness([]);
    expect((await createSyntxImageAdapter(h2.options).edit({ model: "banana/nano-banana", formData: empty, credentials: CREDS })).status).toBe(400);
    expect(h2.calls).toHaveLength(0);
  });
});

describe("no replay and failure accounting", () => {
  const run = (steps, extra = {}) => {
    const h = harness(steps);
    return createSyntxImageAdapter(h.options).generate({ model: "flux/flux-pro", body: { prompt: PROMPT }, credentials: CREDS, ...extra })
      .then((result) => ({ result, h }));
  };

  it("a 5xx generate is sent once and carries acceptedJob; the upstream body is never quoted", async () => {
    const { result, h } = await run([chatCreated(), leaky(503)]);
    expect(result.status).toBe(502);
    expect(result.acceptedJob?.meta.jobState).toBe("submit-unknown");
    expect(generateCalls(h.calls)).toHaveLength(1);
    expect(errorText(result)).not.toContain(JWT_A);
    expect(errorText(result)).not.toContain("upstream echo");
  });

  it("a 4xx generate is refused without acceptedJob and without quoting the body", async () => {
    for (const status of [400, 401, 403, 402]) {
      const { result } = await run([chatCreated(), leaky(status)]);
      expect(result.status).toBe(status);
      expect(result.acceptedJob).toBeUndefined();
      expect(result.quotaExhausted).toBeUndefined();
      expect(errorText(result)).not.toContain("upstream echo");
    }
  });

  it("a 429 is a rate limit with Retry-After evidence, not a quota flag", async () => {
    const { result } = await run([chatCreated(), leaky(429)].map((step, i) => (i === 1 ? json({ detail: "x" }, 429, { "retry-after": "30" }) : step)));
    expect(result.status).toBe(429);
    expect(result.quotaExhausted).toBeUndefined();
    expect(result.acceptedJob).toBeUndefined();
  });

  it("a transport failure after send carries acceptedJob; a pre-connect failure does not", async () => {
    const after = await run([chatCreated(), () => { throw transportError("ECONNRESET"); }]);
    expect(after.result.acceptedJob?.meta.jobState).toBe("submit-unknown");
    expect(errorText(after.result)).not.toContain(JWT_A);
    const before = await run([chatCreated(), () => { throw transportError("ENOTFOUND"); }]);
    expect(before.result.status).toBe(502);
    expect(before.result.acceptedJob).toBeUndefined();
  });

  it("chat-creation failures never submit and never carry acceptedJob", async () => {
    for (const step of [leaky(500), leaky(401), () => { throw transportError("ECONNRESET"); }]) {
      const { result, h } = await run([step]);
      expect(result.acceptedJob).toBeUndefined();
      expect(h.calls).toHaveLength(1);
    }
  });

  it("refuses API redirects without following them, before and after submit", async () => {
    const redirect = () => new Response(null, { status: 302, headers: { location: "https://evil.example/steal" } });
    const pre = await run([redirect()]);
    expect(pre.result.status).toBe(502);
    expect(pre.h.calls).toHaveLength(1);
    const sub = await run([chatCreated(), redirect()]);
    expect(sub.result.status).toBe(502);
    expect(sub.h.calls).toHaveLength(2);
    const foreign = await run([chatCreated(), () => withUrl(accepted(), "https://evil.example/x")]);
    expect(foreign.result.acceptedJob?.meta.jobState).toBe("submit-unknown");
  });

  it("stops after five consecutive poll errors with acceptedJob and no resubmit", async () => {
    const { result, h } = await run([chatCreated(), accepted(), leaky(500), leaky(502), () => { throw new Error("net"); }, new Response("{"), leaky(503)]);
    expect(result.acceptedJob?.meta.jobState).toBe("poll-lost");
    expect(generateCalls(h.calls)).toHaveLength(1);
    expect(errorText(result)).not.toContain("upstream echo");
  });

  it("resets the poll error count after a good answer", async () => {
    const { result } = await run([chatCreated(), accepted(), leaky(500), leaky(500), leaky(500), leaky(500), pending(), leaky(500), done([IMG_A])]);
    expect(result.success).toBe(true);
  });

  it("stops at once when the JWT is refused during polling", async () => {
    const { result, h } = await run([chatCreated(), accepted(), leaky(401)]);
    expect(result.status).toBe(401);
    expect(result.acceptedJob?.meta.jobState).toBe("poll-lost");
    expect(h.calls).toHaveLength(3);
  });

  it("times out at the bounded deadline with acceptedJob", async () => {
    const steps = [chatCreated(), accepted(), ...Array.from({ length: 400 }, () => () => pending())];
    const h = harness(steps);
    const result = await createSyntxImageAdapter(h.options).generate({ model: "flux/flux-pro", body: { prompt: PROMPT, timeout_ms: 20_000 }, credentials: CREDS });
    expect(result.status).toBe(504);
    expect(result.acceptedJob?.meta.jobState).toBe("poll-timeout");
    expect(syntxPollTimeout(10 ** 9)).toBe(600_000);
    expect(syntxPollTimeout(1)).toBe(1_000);
    expect(syntxPollTimeout(undefined)).toBe(600_000);
  });

  it("a cancel while waiting carries acceptedJob; a cancel before send does not", async () => {
    const controller = new AbortController();
    const h = harness([chatCreated(), accepted(), () => { controller.abort(); return pending(); }]);
    const result = await createSyntxImageAdapter(h.options).generate({ model: "flux/flux-pro", body: { prompt: PROMPT }, credentials: CREDS, signal: controller.signal });
    expect(result.status).toBe(499);
    expect(result.acceptedJob?.meta.jobState).toBe("cancelled");

    const early = new AbortController();
    early.abort();
    const h2 = harness([]);
    const r2 = await createSyntxImageAdapter(h2.options).generate({ model: "flux/flux-pro", body: { prompt: PROMPT }, credentials: CREDS, signal: early.signal });
    expect(r2.status).toBe(499);
    expect(r2.acceptedJob).toBeUndefined();
    expect(h2.calls).toHaveLength(0);
  });

  it("bounds a hung submit by its deadline and records it as submit-unknown", async () => {
    const h = harness([chatCreated(), () => new Promise(() => {})]);
    const result = await createSyntxImageAdapter({ ...h.options, submitTimeoutMs: 20 }).generate({ model: "flux/flux-pro", body: { prompt: PROMPT }, credentials: CREDS });
    expect(result.status).toBe(504);
    expect(result.acceptedJob?.meta.jobState).toBe("submit-unknown");
  });

  it("keeps credentials account scoped: each call uses only its own connection", async () => {
    const h = harness([chatCreated(), accepted(), done([IMG_A]), chatCreated("chat-2"), accepted(), done([IMG_B])]);
    const adapter = createSyntxImageAdapter(h.options);
    await adapter.generate({ model: "flux/flux-pro", body: { prompt: PROMPT }, credentials: { apiKey: JWT_A } });
    await adapter.generate({ model: "flux/flux-pro", body: { prompt: PROMPT }, credentials: { accessToken: JWT_B } });
    expect(h.calls.slice(0, 3).every((call) => call.init.headers.authorization === `Bearer ${JWT_A}`)).toBe(true);
    expect(h.calls.slice(3).every((call) => call.init.headers.authorization === `Bearer ${JWT_B}`)).toBe(true);
  });
});

describe("result URL policy and download", () => {
  it("accepts only public https URLs without userinfo", () => {
    expect(syntxPublicUrl(IMG_A)).toBe(IMG_A);
    for (const bad of ["http://r2.syntx.ai/a", "https://localhost/a", "https://10.1.2.3/a", "https://[::1]/a", "https://u:p@r2.syntx.ai/a",
      "https://169.254.169.254/", "ftp://r2.syntx.ai/a", "javascript:alert(1)", 42, ""]) {
      expect(syntxPublicUrl(bad)).toBeNull();
    }
  });

  it("refuses a hostname that resolves to a private address or does not resolve", async () => {
    let fetched = 0;
    const fetchImpl = async () => { fetched += 1; return bytesResponse(PNG); };
    const priv = await downloadSyntxMedia(IMG_A, { fetchImpl, lookup: async () => [{ address: "10.0.0.8", family: 4 }] });
    expect(priv).toMatchObject({ success: false, reason: "blocked" });
    const mixed = await downloadSyntxMedia(IMG_A, { fetchImpl, lookup: async () => [{ address: "93.184.216.34", family: 4 }, { address: "::1", family: 6 }] });
    expect(mixed).toMatchObject({ success: false, reason: "blocked" });
    const none = await downloadSyntxMedia(IMG_A, { fetchImpl, lookup: async () => { throw new Error("ENOTFOUND"); } });
    expect(none).toMatchObject({ success: false, reason: "blocked" });
    expect(fetched).toBe(0);
  });

  it("re-validates every redirect hop, caps hops at three and never sends credentials", async () => {
    const seen = [];
    const hops = {
      "https://a.example.com/1": new Response(null, { status: 302, headers: { location: "https://b.example.com/2" } }),
      "https://b.example.com/2": new Response(null, { status: 302, headers: { location: "https://internal.example.com/3" } }),
    };
    const fetchImpl = async (url, init) => { seen.push({ url, init }); return hops[url]; };
    const lookup = async (host) => [{ address: host === "internal.example.com" ? "192.168.1.4" : "93.184.216.34", family: 4 }];
    const result = await downloadSyntxMedia("https://a.example.com/1", { fetchImpl, lookup });
    expect(result).toMatchObject({ success: false, reason: "blocked" });
    expect(seen.map((s) => s.url)).toEqual(["https://a.example.com/1", "https://b.example.com/2"]);
    expect(seen.every((s) => s.init.redirect === "manual" && Object.keys(s.init.headers).join() === "accept")).toBe(true);

    const loop = async (url) => new Response(null, { status: 302, headers: { location: `${url}x` } });
    const looped = await downloadSyntxMedia("https://a.example.com/l", { fetchImpl: loop, lookup: publicLookup });
    expect(looped).toMatchObject({ success: false, reason: "redirects" });

    const toHttp = async () => new Response(null, { status: 301, headers: { location: "http://a.example.com/plain" } });
    expect(await downloadSyntxMedia("https://a.example.com/s", { fetchImpl: toHttp, lookup: publicLookup })).toMatchObject({ reason: "blocked" });
  });

  it("bounds size, time and cancellation", async () => {
    const big = await downloadSyntxMedia(IMG_A, { fetchImpl: async () => bytesResponse(Buffer.alloc(64)), lookup: publicLookup, maxBytes: 16 });
    expect(big).toMatchObject({ success: false, reason: "too-large" });
    const declared = await downloadSyntxMedia(IMG_A, {
      fetchImpl: async () => new Response(PNG, { headers: { "content-length": "999999999" } }), lookup: publicLookup, maxBytes: 1024,
    });
    expect(declared).toMatchObject({ reason: "too-large" });
    const hung = await downloadSyntxMedia(IMG_A, { fetchImpl: () => new Promise(() => {}), lookup: publicLookup, timeoutMs: 20 });
    expect(hung).toMatchObject({ success: false, status: 504, reason: "timeout" });
    const controller = new AbortController();
    const cancelled = downloadSyntxMedia(IMG_A, { fetchImpl: () => new Promise(() => {}), lookup: publicLookup, signal: controller.signal });
    controller.abort();
    expect(await cancelled).toMatchObject({ status: 499, reason: "aborted" });
    expect(await downloadSyntxMedia(IMG_A, { fetchImpl: async () => new Response(""), lookup: publicLookup })).toMatchObject({ reason: "empty" });
  });
});

describe("video", () => {
  it("posts video/generate with chat_id, uploaded and passthrough file_urls, audio_url and grok rules", async () => {
    const h = harness([json({ files: [{ url: "https://r2.syntx.ai/up/frame.png" }] }), chatCreated(), accepted(), done([VIDEO], "video")]);
    const result = await createSyntxVideoAdapter(h.options).generate({
      model: "grok_video/grok_i2v",
      body: { prompt: PROMPT, image: DATA_PNG, aspect_ratio: "16:9", duration: 5, resolution: "720p", audio_url: "https://cdn.example.com/a.mp3" },
      credentials: CREDS,
    });
    expect(await result.response.json()).toMatchObject({ data: [{ url: VIDEO, format: "mp4" }] });
    expect(result.accounting.nativeUnits).toEqual({ videos: 1 });
    expect(h.calls[1].body).toEqual({ title: PROMPT, scope: "video" });
    expect(h.calls[2].url).toBe(`${ORIGIN}/api/v1/video/generate?ai_name=grok_video`);
    expect(h.calls[2].body).toEqual({
      chat_id: CHAT, prompt: PROMPT,
      settings: { model_type: "grok_i2v", video_duration: 5, resolution: "720p" },
      file_urls: ["https://r2.syntx.ai/up/frame.png"],
      audio_url: "https://cdn.example.com/a.mp3",
    });
    expect(h.calls[1].body.chat_uuid).toBeUndefined();
  });

  it("enforces required images and validates audio_url before sending", async () => {
    const h = harness([]);
    const adapter = createSyntxVideoAdapter(h.options);
    expect((await adapter.generate({ model: "grok_video/grok_i2v", body: { prompt: PROMPT }, credentials: CREDS })).status).toBe(400);
    expect((await adapter.generate({ model: "kling/kling-2.1", body: { prompt: PROMPT, audio_url: "http://10.0.0.1/a" }, credentials: CREDS })).status).toBe(400);
    expect((await adapter.generate({ model: "beeble/beeble", body: { prompt: PROMPT, image: DATA_PNG }, credentials: CREDS })).status).toBe(400);
    expect(h.calls).toHaveLength(0);
  });

  it("prefers the video object and downloads it for b64_json", async () => {
    const h = harness([chatCreated(), accepted(), messages(message([
      { object_type: "image", object_url: IMG_A, completed: true }, { object_type: "video", object_url: VIDEO, completed: true },
    ]))], { downloads: { [VIDEO]: bytesResponse(Buffer.from("video-bytes"), "video/mp4") } });
    const result = await createSyntxVideoAdapter(h.options).generate({ model: "kling/kling-2.1", body: { prompt: PROMPT, response_format: "b64_json" }, credentials: CREDS });
    expect(await result.response.json()).toMatchObject({ data: [{ b64_json: Buffer.from("video-bytes").toString("base64"), format: "mp4" }] });
    expect(h.downloadCalls.map((call) => call.url)).toEqual([VIDEO]);
  });
});

describe("speech", () => {
  it("posts audio/generate in an audio chat, maps voice settings and returns the sniffed mp3", async () => {
    const h = harness([chatCreated(), accepted(), done([AUDIO], "audio")], { downloads: { [AUDIO]: bytesResponse(MP3, "audio/mpeg") } });
    const result = await createSyntxTtsAdapter(h.options).synthesize("Hello there", "elevenlabs/eleven_turbo_v2", CREDS, "mp3", {
      voice: "Rachel", speed: 1.2, instructions: "calm",
    });
    expect(result).toMatchObject({ base64: MP3.toString("base64"), format: "mp3", accounting: { modality: "tts" } });
    expect(h.calls[0].body).toEqual({ title: "Hello there", scope: "audio" });
    expect(h.calls[1].url).toBe(`${ORIGIN}/api/v1/audio/generate?ai_name=elevenlabs`);
    expect(h.calls[1].body).toEqual({
      chat_uuid: CHAT, prompt: "Hello there",
      settings: { model_type: "eleven_turbo_v2", voice_id: "Rachel", speed: 1.2, prompt: "calm" },
    });
  });

  it("drops the OpenAI default voice, refuses non-mp3 formats before sending, and refuses an unexpected container after", async () => {
    const h0 = harness([]);
    expect((await createSyntxTtsAdapter(h0.options).synthesize("hi", "elevenlabs/eleven_turbo_v2", CREDS, "wav", { requestedResponseFormat: "wav" })).status).toBe(400);
    expect(h0.calls).toHaveLength(0);

    const h = harness([chatCreated(), accepted(), done([AUDIO], "audio")], { downloads: { [AUDIO]: bytesResponse(WAV, "audio/wav") } });
    const result = await createSyntxTtsAdapter(h.options).synthesize("hi", "elevenlabs/eleven_turbo_v2", CREDS, "mp3", { voice: "alloy", requestedResponseFormat: "mp3" });
    expect(h.calls[1].body.settings).toEqual({ model_type: "eleven_turbo_v2" });
    expect(result.status).toBe(502);
    expect(result.acceptedJob?.meta.jobState).toBe("accepted");
    expect(sniffAudioFormat(WAV)).toBe("wav");
    expect(sniffAudioFormat(MP3)).toBe("mp3");
  });
});

describe("music", () => {
  it("posts audio/generate with instrumental and duration and returns the URL", async () => {
    const h = harness([chatCreated(), accepted(), done([AUDIO], "audio")]);
    const result = await createSyntxMusicAdapter(h.options).generate({
      model: "suno/chirp-v4", body: { prompt: PROMPT, instrumental: true, duration: 60 }, credentials: CREDS,
    });
    expect(await result.response.json()).toMatchObject({ data: [{ url: AUDIO, format: "mp3" }] });
    expect(result.accounting).toMatchObject({ modality: "music", meta: { clips: 1, chatId: CHAT } });
    expect(h.calls[1].url).toBe(`${ORIGIN}/api/v1/audio/generate?ai_name=suno`);
    expect(h.calls[1].body.settings).toEqual({ model_type: "chirp-v4", duration: 60, is_instrumental: true });
  });

  it("returns base64 audio when asked and refuses an empty prompt", async () => {
    const h = harness([chatCreated(), accepted(), done([AUDIO], "audio")], { downloads: { [AUDIO]: bytesResponse(MP3, "audio/mpeg") } });
    const result = await createSyntxMusicAdapter(h.options).generate({ model: "suno-music/suno", body: { prompt: PROMPT, response_format: "b64_json" }, credentials: CREDS });
    expect(await result.response.json()).toMatchObject({ data: [{ b64_json: MP3.toString("base64"), format: "mp3" }] });
    const h2 = harness([]);
    expect((await createSyntxMusicAdapter(h2.options).generate({ model: "suno/chirp-v4", body: {}, credentials: CREDS })).status).toBe(400);
    expect(h2.calls).toHaveLength(0);
  });
});

describe("transcription", () => {
  const audioForm = (extra = {}) => {
    const form = new FormData();
    form.append("file", new File([MP3], "clip.mp3", { type: "audio/mpeg" }));
    for (const [key, value] of Object.entries(extra)) form.append(key, value);
    return form;
  };

  it("posts the file once as multipart and returns json or text", async () => {
    const h = harness([json({ text: "hello world" }), json({ data: { text: "nested" } }), new Response("plain words")]);
    const adapter = createSyntxSttAdapter(h.options);
    const first = await adapter.transcribe({ model: "transcribe", formData: audioForm(), credentials: CREDS });
    expect(await first.response.json()).toEqual({ text: "hello world" });
    expect(first.accounting).toMatchObject({ modality: "stt" });
    expect(h.calls[0].url).toBe(TRANSCRIBE);
    expect(h.calls[0].init.headers.authorization).toBe(`Bearer ${JWT_A}`);
    expect(Buffer.from(await h.calls[0].body.get("file").arrayBuffer())).toEqual(MP3);
    expect(h.calls[0].body.get("file").name).toBe("clip.mp3");
    const second = await adapter.transcribe({ model: "transcribe", formData: audioForm({ response_format: "text" }), credentials: CREDS });
    expect(await second.response.text()).toBe("nested");
    const third = await adapter.transcribe({ model: "transcribe", formData: audioForm(), credentials: CREDS });
    expect(await third.response.json()).toEqual({ text: "plain words" });
    expect(syntxTranscriptText("{}")).toBe("");
  });

  it("refuses translations, other models, other formats, missing and oversize files before sending", async () => {
    const h = harness([]);
    const adapter = createSyntxSttAdapter(h.options);
    expect((await adapter.transcribe({ model: "transcribe", formData: audioForm(), credentials: CREDS, kind: "translation" })).status).toBe(400);
    expect((await adapter.transcribe({ model: "whisper-1", formData: audioForm(), credentials: CREDS })).status).toBe(400);
    expect((await adapter.transcribe({ model: "transcribe", formData: audioForm({ response_format: "srt" }), credentials: CREDS })).status).toBe(400);
    expect((await adapter.transcribe({ model: "transcribe", formData: new FormData(), credentials: CREDS })).status).toBe(400);
    const fakeForm = { get: (key) => (key === "file" ? { size: 60 * 1024 * 1024, type: "audio/mpeg", name: "big.mp3", arrayBuffer: async () => new ArrayBuffer(0) } : null) };
    expect((await adapter.transcribe({ model: "transcribe", formData: fakeForm, credentials: CREDS })).status).toBe(413);
    expect((await adapter.transcribe({ model: "transcribe", formData: audioForm(), credentials: {} })).status).toBe(401);
    expect(h.calls).toHaveLength(0);
  });

  it("a 5xx or interrupted transcription carries acceptedJob and is not resent", async () => {
    const h = harness([leaky(500), () => { throw transportError("ECONNRESET"); }, leaky(400)]);
    const adapter = createSyntxSttAdapter(h.options);
    const five = await adapter.transcribe({ model: "transcribe", formData: audioForm(), credentials: CREDS });
    expect(five.acceptedJob?.meta.jobState).toBe("submit-unknown");
    expect(errorText(five)).not.toContain("upstream echo");
    const reset = await adapter.transcribe({ model: "transcribe", formData: audioForm(), credentials: CREDS });
    expect(reset.acceptedJob?.meta.jobState).toBe("submit-unknown");
    const four = await adapter.transcribe({ model: "transcribe", formData: audioForm(), credentials: CREDS });
    expect(four.status).toBe(400);
    expect(four.acceptedJob).toBeUndefined();
    expect(h.calls).toHaveLength(3);
  });
});


describe("private providerOptions wire regressions", () => {
  it("keeps the public mapper exports and the caller-owned options mutation contract", () => {
    const providerOptions = mapSyntxImageSettings("seedream", "seedream-5", { size: "1K", n: 2 });
    expect(providerOptions).toEqual({ model_type: "seedream-5", n: 2, resolution: "1K" });
    expect(applySyntxProviderRules("seedream", providerOptions, { modelType: "seedream-5" })).toBeUndefined();
    expect(providerOptions).toEqual({ model_type: "seedream-5", n: 2, resolution: "2K" });
  });

  it("serializes provider options under the source settings key only", async () => {
    const h = harness([chatCreated(), accepted(), done([IMG_A])]);
    const result = await createSyntxImageAdapter(h.options).generate({
      model: "sora-images/gpt-image-2", body: { prompt: PROMPT, size: "16:9", quality: "high" }, credentials: CREDS,
    });
    expect(result.success).toBe(true);
    expect(generateCalls(h.calls)[0].body).toEqual({
      chat_uuid: CHAT, prompt: PROMPT,
      settings: { model_type: "gpt-image-2", n: 1, aspect_ratio: "16:9", quality: "high" },
    });
    expect(generateCalls(h.calls)[0].body).not.toHaveProperty("providerOptions");
  });
});
