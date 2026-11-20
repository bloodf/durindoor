import { afterEach, describe, expect, it, vi } from "vitest";
import { KimiWebExecutor, frameConnectMessage } from "../../open-sse/executors/kimi-web.js";

vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: vi.fn() }));
import { proxyAwareFetch } from "open-sse/utils/proxyFetch.js";

afterEach(() => vi.clearAllMocks());

const session = (access, refresh, origin) => ({ apiKey: JSON.stringify({ access_token: access, refresh_token: refresh, origin }) });
const body = { model: "k2d6", messages: [{ role: "user", content: "hello" }] };

describe("Kimi Web session isolation and streaming", () => {
  it("does not reuse a rotated session across deployment origins", async () => {
    const executor = new KimiWebExecutor();
    const com = session("fake-com-access", "fake-shared-refresh", "https://www.kimi.com");
    const ai = session("fake-ai-access", "fake-shared-refresh", "https://www.kimi.ai");
    proxyAwareFetch.mockResolvedValueOnce(Response.json({ access_token: "fake-rotated-com", refresh_token: "fake-new-refresh" }));
    await executor.refreshCredentials(com);
    proxyAwareFetch.mockResolvedValueOnce(new Response(frameConnectMessage(JSON.stringify({})), { status: 200 }));
    await executor.execute({ body, credentials: ai, stream: false });
    expect(proxyAwareFetch.mock.calls[1][0]).toContain("www.kimi.ai/");
    expect(proxyAwareFetch.mock.calls[1][1].headers.Authorization).toBe("Bearer fake-ai-access");
  });

  it("redacts the access token from streamed Connect errors", async () => {
    const token = "fake-stream-access";
    const trailer = frameConnectMessage(JSON.stringify({ error: { message: `rejected ${token}` } }));
    trailer[0] = 2;
    proxyAwareFetch.mockResolvedValueOnce(new Response(trailer, { status: 200 }));
    const { response } = await new KimiWebExecutor().execute({ body, credentials: session(token, "", "https://www.kimi.com"), stream: true });
    const text = await response.text();
    expect(text).not.toContain(token);
    expect(text).toContain("[redacted]");
  });
});
