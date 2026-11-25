import { describe, expect, it, vi } from "vitest";
import provider, { doubaoWebCookieProfile } from "../../open-sse/providers/registry/doubao-web.js";
import { DoubaoWebExecutor } from "../../open-sse/executors/doubao-web.js";

const cookieA = "sessionid=synth_a; ttwid=t_a; s_v_web_id=verify_a";
const cookieB = "sessionid=synth_b; ttwid=t_b; s_v_web_id=verify_b";
const event = (s) => `event: MESSAGE_DELTA\ndata: ${JSON.stringify({ content: { content_block: [{ content: { text_block: { text: s } } }] } })}\n\n`;
const response = (body, status = 200) => new Response(body, { status, headers: { "content-type": "text/event-stream" } });

describe("Doubao Web provider contract", () => {
  it("exposes the cookie profile and models", () => {
    expect(provider.id).toBe("doubao-web");
    expect(doubaoWebCookieProfile.cookieNames).toContain("sessionid");
    expect(provider.models.map((m) => m.id)).toEqual(["dola-speed", "dola-pro"]);
  });
  it("validates required session and fingerprint cookies", async () => {
    const exec = new DoubaoWebExecutor({ fetch: vi.fn(async () => response(event("ok"))) });
    expect((await exec.execute({ credentials: { apiKey: cookieA }, body: { messages: [] } })).response.status).toBe(200);
    expect((await exec.execute({ credentials: { apiKey: "sessionid=bad" }, body: { messages: [] } })).response.status).toBe(401);
  });
  it("maps expired credentials and quota responses", async () => {
    const auth = new DoubaoWebExecutor({ fetch: vi.fn(async () => response("expired", 403)) });
    const quota = new DoubaoWebExecutor({ fetch: vi.fn(async () => response("quota", 429)) });
    expect((await auth.execute({ credentials: { apiKey: cookieA }, body: {} })).response.status).toBe(403);
    expect((await quota.execute({ credentials: { apiKey: cookieA }, body: {} })).response.status).toBe(429);
  });
  it("returns JSON and OpenAI SSE responses and isolates connection cookies", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response(event("json answer"))).mockResolvedValueOnce(response(event("stream answer"))).mockResolvedValueOnce(response(event("A"))).mockResolvedValueOnce(response(event("B")));
    const exec = new DoubaoWebExecutor({ fetch });
    const invoke = (cookie, stream = false) => exec.execute({ credentials: { apiKey: cookie }, body: { model: "dola-speed", messages: [{ role: "user", content: "hi" }] }, stream });
    const json = await (await invoke(cookieA)).response.json();
    const streamed = await (await invoke(cookieA, true)).response.text();
    await invoke(cookieA); await invoke(cookieB);
    expect(json.choices[0].message.content).toBe("json answer");
    expect(streamed).toContain("stream answer");
    expect(streamed).toContain("data: [DONE]");
    expect(fetch.mock.calls[2][1].headers.Cookie).toBe(cookieA);
    expect(fetch.mock.calls[3][1].headers.Cookie).toBe(cookieB);
  });
});
