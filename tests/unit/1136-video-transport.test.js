import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

import { handleVideoProxyCore } from "open-sse/handlers/videoCore.js";
import { supportsVideoGeneration, handleVideoGenerationCore } from "open-sse/handlers/videoGenerationCore.js";
import { mediaTransportSupport } from "../../src/sse/services/mediaTransport.js";

const readFixture = (name) => JSON.parse(readFileSync(new URL(`../fixtures/media/${name}`, import.meta.url), "utf8"));
const jsonResponse = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());

describe("#1136 video transport evidence", () => {
  it("keeps synthetic fixtures explicit and pins synchronous discovery shape", () => {
    const fixture = readFixture("veoaifree-web.video-sync.json");
    expect(fixture).toMatchObject({ synthetic: true, verifiedLive: false, kind: "video", transport: "synchronous" });
    expect(fixture.liveGap).toMatch(/No live verification/);
    expect(supportsVideoGeneration(fixture.vendor)).toBe(true);
    expect(fixture.request.body.actionType).toBe("full-video-generate");
    expect(fixture.response.body.data[0].type).toBe("video");
  });

  it("matches MiniMax async submission and polling to the synthetic fixture", async () => {
    const fixture = readFixture("minimax.video-async.json");
    expect(fixture).toMatchObject({ synthetic: true, verifiedLive: false, kind: "video", transport: "asynchronous" });
    expect(fixture.liveGap).toMatch(/No live verification/);
    const fetch = vi.fn().mockResolvedValueOnce(jsonResponse({ task_id: "fixture-task" })).mockResolvedValueOnce(jsonResponse(fixture.response.poll.body));
    vi.stubGlobal("fetch", fetch);
    const created = await handleVideoProxyCore({ provider: "minimax", action: "generations", rawBody: JSON.stringify({ model: fixture.model, prompt: "A lantern over a lake", resolution: "2K", duration: 5, aspect_ratio: "16:9" }), contentType: "application/json", credentials: { apiKey: "fixture-key" } });
    expect(fetch.mock.calls[0][0]).toBe(fixture.request.url);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(fixture.request.body);
    expect(await created.response.json()).toEqual(fixture.response.submit.normalized);
    const polled = await handleVideoProxyCore({ provider: "minimax", requestId: "fixture-task", credentials: { apiKey: "fixture-key" } });
    expect(await polled.response.json()).toEqual(fixture.response.poll.normalized);
  });

  it("returns endpoint-specific errors for known sync/async mismatches while allowing unknown model IDs", async () => {
    const asyncOnSync = await handleVideoGenerationCore({ provider: "xai", model: "unknown-future-video-model", body: { prompt: "test" }, credentials: {} });
    expect(asyncOnSync.success).toBe(false);
    expect(asyncOnSync.error).toMatch(/Use \/v1\/videos for asynchronous video jobs/);
    expect(supportsVideoGeneration("custom-video-node")).toBe(false);
    expect(mediaTransportSupport("video", "custom-video-node")).toBe("unknown");
    expect(readFixture("minimax.video-async.json").model).toBe("MiniMax-H3");
  });
});
