import { afterEach, describe, expect, it, vi } from "vitest";
import { getExecutor } from "open-sse/executors/index.js";
import { PROVIDER_MODELS } from "open-sse/providers/index.js";
import { parseMetaAiResponseText } from "open-sse/executors/muse-spark-web/response-parser.js";
import { getProvider } from "@/lib/oauth/providers.js";
import { absorbSetCookies, beginSession, destroySession, getSession, hasRequiredCookies, SESSION_TTL_MS } from "@/lib/webLoginSession.js";
import web from "open-sse/providers/registry/muse-spark-web.js";
import llama from "open-sse/providers/registry/meta-llama.js";

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("Muse Spark web boundaries", () => {
  it("captures only the required web session and expires the login session", () => {
    vi.useFakeTimers();
    const sess = beginSession("muse-spark-web");
    expect(beginSession("muse-code")).toBeNull();
    expect(beginSession("meta-llama")).toBeNull();
    expect(hasRequiredCookies(sess)).toBe(false);
    absorbSetCookies(sess, new Response(null, { headers: { "Set-Cookie": "ecto_1_sess=fake-web; Path=/" } }), "https://www.meta.ai/");
    expect(hasRequiredCookies(sess)).toBe(true);
    vi.advanceTimersByTime(SESSION_TTL_MS + 1);
    expect(getSession(sess.id)).toBeNull();
    destroySession(sess.id);
  });

  it("keeps web catalog and cookie auth separate from device and API key auth", () => {
    expect(web.authType).toBe("cookie");
    expect(llama.authType).toBe("apikey");
    expect(getProvider("muse-code").flowType).toBe("device_code");
    expect(() => getProvider("muse-spark-web")).toThrow("Unknown provider");
    expect(PROVIDER_MODELS["ms-web"].map((model) => model.id)).toEqual(expect.arrayContaining(["muse-spark", "muse-spark-thinking", "muse-spark-contemplating"]));
  });

  it.each(["muse-spark-web", "ms-web"])("fails closed on normal %s dispatch without sending credentials", async (provider) => {
    const fetch = vi.fn(() => { throw new Error("unexpected outbound request"); });
    vi.stubGlobal("fetch", fetch);
    const executor = getExecutor(provider);
    const { response, headers } = await executor.execute({ model: "muse-spark", body: { messages: [{ role: "user", content: "hello" }] }, credentials: { apiKey: "ecto_1_sess=fake-web" } });
    expect(response.status).toBe(501);
    expect(await response.json()).toMatchObject({ error: { type: "provider_port_pending", provider: "muse-spark-web" } });
    expect(headers).toEqual({});
    expect(fetch).not.toHaveBeenCalled();
    expect(() => executor.buildHeaders({ apiKey: "fake-web" })).toThrow();
    vi.unstubAllGlobals();
  });

  it("parses assistant snapshots and recognizes an expired session", () => {
    const frame = (content) => `data: ${JSON.stringify({ data: { sendMessageStream: { __typename: "AssistantMessage", content } } })}\n\n`;
    expect(parseMetaAiResponseText(frame("Hello") + frame("Hello world"), false)).toMatchObject({ status: 200, content: "Hello world", deltas: ["Hello", " world"] });
    expect(parseMetaAiResponseText(frame("Authentication required to send messages"), false)).toMatchObject({ status: 401 });
  });
});
