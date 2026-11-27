// Google Flow (googleflow) video, staged and unregistered. The pinned source
// disables this provider (unsupported: true, #10285) and its handler answers
// 501 without touching the network, so these tests assert that the staged
// adapter does the same. global.fetch is replaced with a spy that fails the
// test if it is ever called. Every credential is synthetic.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import defaultAdapter, {
  createGoogleFlowVideoAdapter,
  GOOGLE_FLOW_NOT_IMPLEMENTED_STATUS,
  GOOGLE_FLOW_VIDEO_RESPONSE_FORMATS,
} from "../../open-sse/services/providerParity/native-googleflow-video/adapter.js";
import {
  GOOGLE_FLOW_AUTH_HEADER,
  GOOGLE_FLOW_AUTH_TYPE,
  GOOGLE_FLOW_CREDENTIAL_PROVIDER,
  GOOGLE_FLOW_FALLBACK_UNSUPPORTED_REASON,
  GOOGLE_FLOW_HOST,
  GOOGLE_FLOW_POLL_PATH,
  GOOGLE_FLOW_REPORTED_WORKING_PATH,
  GOOGLE_FLOW_SUBMIT_PATH,
  GOOGLE_FLOW_UNSUPPORTED_REASON,
  GOOGLE_FLOW_VIDEO_FORMAT,
  GOOGLE_FLOW_VIDEO_MODEL_IDS,
  GOOGLE_FLOW_VIDEO_PROVIDER_ALIASES,
  GOOGLE_FLOW_VIDEO_PROVIDER_ID,
  GOOGLE_FLOW_VIDEO_PROVIDER_METADATA,
  googleFlowVideoModel,
} from "../../open-sse/services/providerParity/native-googleflow-video/config.js";
import {
  buildGoogleFlowSubmitBody,
  googleFlowPublicArtifact,
  normalizeFlowVideoParams,
  parseFlowOperationName,
  parseFlowOperationResult,
  resolveFlowAccessToken,
  resolveFlowProjectId,
  resolveVideoCredentialProvider,
} from "../../open-sse/services/providerParity/native-googleflow-video/contract.js";
import * as bundle from "../../open-sse/services/providerParity/native-googleflow-video/index.js";
import { getVideoGenerationAdapter } from "../../open-sse/handlers/videoProviders/index.js";
import { PROVIDERS } from "../../open-sse/providers/index.js";

const BUNDLE = new URL("../../open-sse/services/providerParity/native-googleflow-video/", import.meta.url);
const registration = JSON.parse(readFileSync(new URL("registration.json", BUNDLE), "utf8"));

const TOKEN_A = "ya29.SYNTHETIC-flow-token-a-0001";
const TOKEN_B = "ya29.SYNTHETIC-flow-token-b-0002";
const CRED_A = { id: "conn-a", accessToken: TOKEN_A, refreshToken: "1//SYNTHETIC-refresh-a", projectId: "synthetic-proj-a" };
const CRED_B = { id: "conn-b", accessToken: TOKEN_B, providerSpecificData: { projectId: "synthetic-proj-b" } };
const BODY = { model: "googleflow/veo-3.1-generate", prompt: "a heron landing on a misty pond", aspect_ratio: "16:9", duration: 8 };

const originalFetch = global.fetch;
let fetchSpy;
beforeEach(() => {
  fetchSpy = vi.fn(async () => {
    throw new Error("unexpected network call");
  });
  global.fetch = fetchSpy;
});
afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("../../open-sse/handlers/videoProviders/index.js");
});

async function errorBody(result) {
  return JSON.parse(await result.response.clone().text());
}

// Isolated staging block: the only assertions that depend on the bundle being
// unregistered. Registration may replace these with positive identity checks;
// every other block holds staged and registered alike.
describe("staging state (pre-registration only)", () => {
  it("is not registered: no public dispatch, registry entry or production import", () => {
    expect(getVideoGenerationAdapter("googleflow")).toBeNull();
    expect(getVideoGenerationAdapter("flow")).toBeNull();
    expect(PROVIDERS.googleflow).toBeUndefined();
    const dispatch = readFileSync(new URL("../../open-sse/handlers/videoProviders/index.js", import.meta.url), "utf8");
    expect(dispatch).not.toContain("native-googleflow-video");
  });
});

describe("source-pinned metadata", () => {
  it("matches the pinned videoRegistry.ts googleflow entry exactly", () => {
    expect(registration.source.commit).toBe("c71f0065a7efe9230ec23b96a12253b050c4d7ad");
    expect(registration.source.registryEntry).toEqual({
      id: "googleflow",
      alias: "flow",
      baseUrl: "https://aisandbox-pa.googleapis.com",
      authType: "oauth",
      authHeader: "bearer",
      format: "google-flow",
      unsupported: true,
      unsupportedReason: GOOGLE_FLOW_UNSUPPORTED_REASON,
    });
    expect(GOOGLE_FLOW_VIDEO_PROVIDER_ID).toBe("googleflow");
    expect(GOOGLE_FLOW_VIDEO_PROVIDER_ALIASES).toEqual(["flow"]);
    expect(GOOGLE_FLOW_VIDEO_FORMAT).toBe("google-flow");
    expect(GOOGLE_FLOW_HOST).toBe("https://aisandbox-pa.googleapis.com");
    expect(GOOGLE_FLOW_AUTH_TYPE).toBe("oauth");
    expect(GOOGLE_FLOW_AUTH_HEADER).toBe("bearer");
    expect(GOOGLE_FLOW_VIDEO_MODEL_IDS).toEqual(["veo-3.1-generate", "veo-3.1-fast-generate", "veo-3.0-generate"]);
    expect(registration.models.map((m) => m.id)).toEqual([...GOOGLE_FLOW_VIDEO_MODEL_IDS]);
    expect(googleFlowVideoModel("veo-3.0-generate").name).toBe("Veo 3.0 (Google Flow)");
    expect(googleFlowVideoModel("veo-3.1-generate-001")).toBeNull();
  });

  it("records the disabled state and evidence instead of claiming support", () => {
    expect(GOOGLE_FLOW_VIDEO_PROVIDER_METADATA.supported).toBe(false);
    expect(GOOGLE_FLOW_VIDEO_PROVIDER_METADATA.unsupported).toBe(true);
    expect(GOOGLE_FLOW_VIDEO_PROVIDER_METADATA.supportedResponseFormats).toEqual([]);
    expect(GOOGLE_FLOW_SUBMIT_PATH).toBe("/v1:generateVideo");
    expect(GOOGLE_FLOW_POLL_PATH).toBe("/v1:fetchOperation");
    expect(GOOGLE_FLOW_REPORTED_WORKING_PATH).toBe("/v1/video:batchAsyncGenerateVideoText");
    expect(GOOGLE_FLOW_VIDEO_PROVIDER_METADATA.endpoints.submit).toMatch(/404/);
    expect(GOOGLE_FLOW_VIDEO_PROVIDER_METADATA.endpoints.reportedWorking).toMatch(/401/);
    expect(registration.provider.supported).toBe(false);
    expect(registration.recommendedRegistration).toMatch(/^none while/);
    expect(registration.publicContract.accepted).toEqual([]);
  });

  it("keeps the source credential mapping to the existing antigravity connection", () => {
    expect(GOOGLE_FLOW_CREDENTIAL_PROVIDER).toBe("antigravity");
    expect(resolveVideoCredentialProvider("googleflow")).toBe("antigravity");
    expect(resolveVideoCredentialProvider("antigravity")).toBe("antigravity");
    expect(resolveVideoCredentialProvider("flow")).toBe("flow");
    expect(resolveVideoCredentialProvider("vertex")).toBe("vertex");
  });

  it("exports the adapter, metadata and dormant contract from index.js", () => {
    expect(bundle.googleFlowVideoAdapter).toBe(defaultAdapter);
    for (const name of [
      "createGoogleFlowVideoAdapter", "GOOGLE_FLOW_VIDEO_PROVIDER_METADATA", "normalizeFlowVideoParams",
      "buildGoogleFlowSubmitBody", "parseFlowOperationName", "parseFlowOperationResult",
      "resolveFlowProjectId", "resolveFlowAccessToken", "resolveVideoCredentialProvider", "googleFlowPublicArtifact",
    ]) expect(bundle[name], name).toBeDefined();
  });
});

describe("fail-fast adapter (source googleFlowHandler.ts)", () => {
  it("follows the job-adapter contract shape", () => {
    expect(defaultAdapter.async).toBe(true);
    expect(defaultAdapter.unsupported).toBe(true);
    expect(defaultAdapter.responseFormats).toBe(GOOGLE_FLOW_VIDEO_RESPONSE_FORMATS);
    expect(defaultAdapter.defaultResponseFormat).toBe("url");
  });

  it("answers 501 with the source reason and never calls the network", async () => {
    const result = await defaultAdapter.generate({ model: "veo-3.1-generate", body: BODY, credentials: CRED_A });
    expect(result.success).toBe(false);
    expect(result.status).toBe(GOOGLE_FLOW_NOT_IMPLEMENTED_STATUS);
    expect(result.status).toBe(501);
    expect(result.error).toBe(GOOGLE_FLOW_UNSUPPORTED_REASON);
    expect(result.response.status).toBe(501);
    expect((await errorBody(result)).error.message).toBe(GOOGLE_FLOW_UNSUPPORTED_REASON);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("records no accepted job and no usage, because nothing is submitted", async () => {
    const result = await defaultAdapter.generate({ model: "veo-3.1-generate", body: BODY, credentials: CRED_A });
    expect(result.acceptedJob).toBeUndefined();
    expect(result.accounting).toBeUndefined();
  });

  it("is identical for two credentials and leaks neither", async () => {
    const a = await defaultAdapter.generate({ model: "veo-3.1-generate", body: BODY, credentials: CRED_A });
    const b = await defaultAdapter.generate({ model: "veo-3.1-fast-generate", body: BODY, credentials: CRED_B });
    expect(a.status).toBe(b.status);
    expect(a.error).toBe(b.error);
    for (const result of [a, b]) {
      const text = JSON.stringify(await errorBody(result)) + result.error;
      for (const secret of [TOKEN_A, TOKEN_B, "SYNTHETIC-refresh-a", "synthetic-proj-a", "synthetic-proj-b"]) {
        expect(text).not.toContain(secret);
      }
    }
    expect(CRED_A.accessToken).toBe(TOKEN_A);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses unsupported inputs, missing credentials and unknown models the same way, before any submit", async () => {
    const cases = [
      { ...BODY, image: "data:image/png;base64,AAAA" },
      { ...BODY, n: 4 },
      { ...BODY, stream: true },
      { ...BODY, response_format: "b64_json" },
    ];
    for (const body of cases) {
      const result = await defaultAdapter.generate({ model: "veo-3.1-generate", body, credentials: CRED_A });
      expect(result.status).toBe(501);
    }
    expect((await defaultAdapter.generate({ model: "not-a-model", body: BODY, credentials: null })).status).toBe(501);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not need a signal and ignores an already-aborted one without network work", async () => {
    const controller = new AbortController();
    controller.abort();
    const listener = vi.spyOn(controller.signal, "addEventListener");
    const result = await defaultAdapter.generate({ model: "veo-3.1-generate", body: BODY, credentials: CRED_A, signal: controller.signal });
    expect(result.status).toBe(501);
    expect(listener).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("falls back to the source handler reason when the registry reason is empty", async () => {
    const adapter = createGoogleFlowVideoAdapter({ unsupportedReason: "" });
    expect((await adapter.generate({})).error).toBe(GOOGLE_FLOW_FALLBACK_UNSUPPORTED_REASON);
  });

  it("has no network, timer or credential code path in the staged adapter", () => {
    const source = readFileSync(new URL("adapter.js", BUNDLE), "utf8").replace(/^\s*\/\/.*$/gm, "");
    for (const token of ["fetch", "setTimeout", "credentials", "accessToken", "aisandbox"]) {
      expect(source, token).not.toContain(token);
    }
  });

  it("passes the 501 through the public video core once registered (mocked dispatch)", async () => {
    vi.resetModules();
    vi.doMock("../../open-sse/handlers/videoProviders/index.js", async (importOriginal) => {
      const actual = await importOriginal();
      return { ...actual, getVideoGenerationAdapter: (p) => (p === "googleflow" ? defaultAdapter : actual.getVideoGenerationAdapter(p)) };
    });
    const { handleVideoGenerationCore } = await import("../../open-sse/handlers/videoGenerationCore.js");
    const result = await handleVideoGenerationCore({ provider: "googleflow", model: "veo-3.1-generate", body: BODY, credentials: CRED_A });
    expect(result.status).toBe(501);
    expect(result.error).toBe(GOOGLE_FLOW_UNSUPPORTED_REASON);
    expect(result.acceptedJob).toBeUndefined();
    const missingPrompt = await handleVideoGenerationCore({ provider: "googleflow", model: "veo-3.1-generate", body: { model: BODY.model }, credentials: CRED_A });
    expect(missingPrompt.status).toBe(400);
    const badFormat = await handleVideoGenerationCore({ provider: "googleflow", model: "veo-3.1-generate", body: { ...BODY, response_format: "mp4" }, credentials: CRED_A });
    expect(badFormat.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("dormant request contract (source googleFlow.ts)", () => {
  it("normalizes snake_case, camelCase and ratio-shaped size exactly as the source", () => {
    expect(normalizeFlowVideoParams({ prompt: "a cat surfing" })).toEqual({
      prompt: "a cat surfing", aspectRatio: undefined, durationSeconds: undefined, sampleCount: 1, negativePrompt: undefined, resolution: undefined,
    });
    expect(normalizeFlowVideoParams({ prompt: "x", aspect_ratio: " 16:9 ", duration: 8.7, n: 2, negative_prompt: "blurry", resolution: "1080p" })).toEqual({
      prompt: "x", aspectRatio: "16:9", durationSeconds: 8, sampleCount: 2, negativePrompt: "blurry", resolution: "1080p",
    });
    const camel = normalizeFlowVideoParams({ prompt: "x", aspectRatio: "9:16", durationSeconds: 4, negativePrompt: "dark" });
    expect([camel.aspectRatio, camel.durationSeconds, camel.negativePrompt]).toEqual(["9:16", 4, "dark"]);
    expect(normalizeFlowVideoParams({ prompt: "x", size: "16:9" }).aspectRatio).toBe("16:9");
    expect(normalizeFlowVideoParams({ prompt: "x", size: "1024x1024" }).aspectRatio).toBeUndefined();
    const junk = normalizeFlowVideoParams({ prompt: 42, n: -1, duration: Infinity });
    expect([junk.prompt, junk.sampleCount, junk.durationSeconds]).toEqual(["42", 1, undefined]);
    expect(normalizeFlowVideoParams(null).prompt).toBe("");
  });

  it("builds the exact Veo instances/parameters body, omitting absent optionals", () => {
    expect(buildGoogleFlowSubmitBody(normalizeFlowVideoParams({ prompt: "a dog", aspect_ratio: "16:9", duration: 6, negative_prompt: "ugly", resolution: "720p" }))).toEqual({
      instances: [{ prompt: "a dog" }],
      parameters: { sampleCount: 1, aspectRatio: "16:9", durationSeconds: 6, negativePrompt: "ugly", resolution: "720p" },
    });
    expect(buildGoogleFlowSubmitBody(normalizeFlowVideoParams({ prompt: "x", n: 3 }))).toEqual({ instances: [{ prompt: "x" }], parameters: { sampleCount: 3 } });
  });

  it("resolves the project and bearer from the credential record as the source does", () => {
    expect(resolveFlowProjectId(CRED_A)).toBe("synthetic-proj-a");
    expect(resolveFlowProjectId(CRED_B)).toBe("synthetic-proj-b");
    expect(resolveFlowProjectId({ projectId: "  " })).toBeNull();
    expect(resolveFlowProjectId(null)).toBeNull();
    expect(resolveFlowAccessToken(CRED_A)).toBe(TOKEN_A);
    expect(resolveFlowAccessToken({ apiKey: "SYNTHETIC-key" })).toBe("SYNTHETIC-key");
    expect(resolveFlowAccessToken({})).toBeNull();
  });
});

describe("dormant response contract (source googleFlow.ts)", () => {
  it("parses operation names and rejects junk", () => {
    expect(parseFlowOperationName({ name: "operations/abc" })).toBe("operations/abc");
    expect(parseFlowOperationName({ operation: { name: "operations/xyz" } })).toBe("operations/xyz");
    for (const junk of [{}, null, "operations/abc", { name: "" }, { name: 7 }, { operation: "x" }]) {
      expect(parseFlowOperationName(junk)).toBeNull();
    }
  });

  it("parses pending, success, failure and empty operations", () => {
    expect(parseFlowOperationResult({ done: false })).toEqual({ done: false });
    expect(parseFlowOperationResult({})).toEqual({ done: false });
    expect(parseFlowOperationResult("done")).toEqual({ done: false });
    expect(parseFlowOperationResult({ done: true, response: { videos: [{ bytesBase64Encoded: "AAAA" }] } })).toEqual({ done: true, base64: "AAAA", format: "mp4" });
    expect(parseFlowOperationResult({ done: true, response: { videos: [{ gcsUri: "gs://b/v.mp4" }] } }).url).toBe("gs://b/v.mp4");
    expect(parseFlowOperationResult({ done: true, response: { videos: [{ uri: "https://x/v.mp4" }] } }).url).toBe("https://x/v.mp4");
    expect(parseFlowOperationResult({ done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: "https://x/sample.mp4" } }] } } }).url).toBe("https://x/sample.mp4");
    expect(parseFlowOperationResult({ done: true, error: { message: "quota exceeded" } })).toEqual({ done: true, error: "quota exceeded" });
    expect(parseFlowOperationResult({ done: true, error: {} }).error).toBe("Google Flow video operation failed");
    for (const response of [undefined, {}, { videos: [] }, { videos: [null] }, { videos: [{}] }, { generateVideoResponse: { generatedSamples: [null] } }]) {
      expect(parseFlowOperationResult({ done: true, response }).error).toMatch(/no video/i);
    }
  });

  it("admits only well-formed base64 or public https URLs for clients (fork hardening)", () => {
    expect(googleFlowPublicArtifact({ done: true, base64: "AAAA", format: "mp4" })).toEqual({ b64_json: "AAAA", format: "mp4" });
    expect(googleFlowPublicArtifact({ done: true, url: "https://cdn.example/v.mp4" })).toEqual({ url: "https://cdn.example/v.mp4", format: "mp4" });
    for (const unsafe of [
      { done: true, url: "gs://private-bucket/v.mp4" },
      { done: true, url: "http://cdn.example/v.mp4" },
      { done: true, url: "https://user:pass@cdn.example/v.mp4" },
      { done: true, url: "file:///etc/passwd" },
      { done: true, url: "not a url" },
      { done: true, base64: "AAA" },
      { done: true, base64: "<html>" },
      { done: true, base64: "" },
      { done: true, error: "quota exceeded" },
      { done: false },
      null,
    ]) {
      expect(googleFlowPublicArtifact(unsafe), JSON.stringify(unsafe)).toBeNull();
    }
  });
});
