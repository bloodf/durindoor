import { afterEach, describe, expect, it, vi } from "vitest";
import { handleMusicGenerationCore } from "../../open-sse/handlers/musicGenerationCore.js";

vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: (...args) => fetch(...args) }));
afterEach(() => vi.unstubAllGlobals());

describe("Udio music contract", () => {
  it("submits the approved cookie and the upstream sampler default", async () => {
    const fetchMock = vi.fn(async () => Response.json({ track_ids: ["track-a", "track-b"] }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await handleMusicGenerationCore({ provider: "udio", model: "udio-default", body: { prompt: "test" }, credentials: { apiKey: "cookie: session=fake-a" } });
    expect(result.success).toBe(true);
    expect(result.job).toEqual({ resourceId: "track-a,track-b", terminal: null });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://www.udio.com/api/generate-proxy");
    expect(options.headers.Cookie).toBe("session=fake-a");
    expect(JSON.parse(options.body)).toMatchObject({ prompt: "test", samplerOptions: { seed: -1 } });
  });
  it("polls only with the selected connection credential and validates job identities", async () => {
    const fetchMock = vi.fn(async () => Response.json([{ id: "track-a", finished: true, song_path: "https://cdn.invalid/a.mp3" }]));
    vi.stubGlobal("fetch", fetchMock);
    const result = await handleMusicGenerationCore({ provider: "udio", model: "udio-default", requestId: "track-a", credentials: { apiKey: "session=fake-b" } });
    expect(result.job).toEqual({ resourceId: "track-a", terminal: "succeeded" });
    expect(result.accounting.state).toBe("complete");
    expect(fetchMock.mock.calls[0][0]).toBe("https://www.udio.com/api/songs?songIds=track-a");
    expect(fetchMock.mock.calls[0][1].headers.Cookie).toBe("session=fake-b");
    fetchMock.mockResolvedValueOnce(Response.json([{ id: "other", finished: true, song_path: "https://cdn.invalid/b.mp3" }]));
    const mismatch = await handleMusicGenerationCore({ provider: "udio", model: "udio-default", requestId: "track-a", credentials: { apiKey: "session=fake-b" } });
    expect(mismatch).toMatchObject({ success: false, status: 502 });
  });
  it("rejects missing credentials and propagates upstream failures", async () => {
    const fetchMock = vi.fn(async () => Response.json({ message: "expired session" }, { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await handleMusicGenerationCore({ provider: "udio", model: "udio-default", body: { prompt: "test" }, credentials: {} })).toMatchObject({ success: false, status: 401 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await handleMusicGenerationCore({ provider: "udio", model: "udio-default", body: { prompt: "test" }, credentials: { apiKey: "session=fake" } })).toMatchObject({ success: false, status: 401 });
  });
});
