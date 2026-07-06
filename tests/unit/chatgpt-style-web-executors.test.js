import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getExecutor, hasSpecializedExecutor } from "open-sse/executors/index.js";
import { AdaptaWebExecutor, buildAdaptaMessages, extractAdaptaClientJwt } from "open-sse/executors/adapta-web.js";
import { buildChatGptConversationBody, buildSessionCookieHeader, ChatGptWebExecutor, mergeRefreshedCookie } from "open-sse/executors/chatgpt-web.js";
import { extractT3Delta, parseT3Credentials, T3WebExecutor, validateT3Credentials } from "open-sse/executors/t3-web.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function sseResponse(lines, contentType = "text/event-stream") {
  const body = lines.map((line) => `data: ${typeof line === "string" ? line : JSON.stringify(line)}\n\n`).join("");
  return new Response(new TextEncoder().encode(body), {
    status: 200,
    headers: { "Content-Type": contentType },
  });
}

function rawStreamResponse(body, contentType = "text/event-stream") {
  return new Response(new TextEncoder().encode(body), {
    status: 200,
    headers: { "Content-Type": contentType },
  });
}

describe("ChatGPT-style web executor registration", () => {
  it.each([
    ["adapta-web", AdaptaWebExecutor],
    ["adp-web", AdaptaWebExecutor],
    ["chatgpt-web", ChatGptWebExecutor],
    ["cgpt-web", ChatGptWebExecutor],
    ["t3-web", T3WebExecutor],
    ["t3chat", T3WebExecutor],
  ])("%s resolves to the ported executor", (provider, klass) => {
    expect(hasSpecializedExecutor(provider)).toBe(true);
    expect(getExecutor(provider)).toBeInstanceOf(klass);
  });
});

describe("Adapta Web executor", () => {
  it("extracts the Clerk __client value from bare, named, and Cookie header input", () => {
    expect(extractAdaptaClientJwt("eyJ.jwt")).toBe("eyJ.jwt");
    expect(extractAdaptaClientJwt("__client=eyJ.jwt")).toBe("eyJ.jwt");
    expect(extractAdaptaClientJwt("foo=bar; __client=eyJ.jwt; other=x")).toBe("eyJ.jwt");
  });

  it("folds system messages into the first user message for Adapta", () => {
    expect(buildAdaptaMessages([
      { role: "system", content: "Be terse." },
      { role: "user", content: "Hi" },
    ])).toEqual([
      { role: "user", parts: [{ type: "text", text: "Be terse.\n\nHi" }] },
    ]);
  });

  it("converts Adapta streaming deltas into non-streaming OpenAI completions", async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ response: { sessions: [{ id: "sess", status: "active" }] } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ jwt: "eyJhbGciOiJub25lIn0.eyJleHAiOjk5OTk5OTk5OTl9." }), { status: 200 }))
      .mockResolvedValueOnce(sseResponse([
        { type: "text-delta", delta: "hello" },
        { type: "text-delta", delta: " world" },
        { type: "done" },
      ]));

    const result = await new AdaptaWebExecutor().execute({
      model: "adapta-one",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: false,
      credentials: { apiKey: "__client=client.jwt" },
    });

    expect(result.response.status).toBe(200);
    const json = await result.response.json();
    expect(json.choices[0].message.content).toBe("hello world");
    expect(result.transformedBody).toMatchObject({ aiModelId: 14 });
  });
});

describe("T3 Web executor", () => {
  it("accepts full Cookie headers and structured convex-session-id input", () => {
    const cookieHeader = parseT3Credentials({ apiKey: "Cookie: t3-auth=abc; convex-session-id=convex" });
    expect(validateT3Credentials(cookieHeader)).toBe(true);
    expect(cookieHeader.cookieHeader).toContain("convex-session-id=convex");

    const structured = parseT3Credentials({ apiKey: "cookies=t3-auth=abc\nconvexSessionId=convex-2" });
    expect(validateT3Credentials(structured)).toBe(true);
    expect(structured.cookieHeader).toContain("convex-session-id=convex-2");
  });

  it("extracts T3 text from direct and TSS-shaped events", () => {
    expect(extractT3Delta({ text: "a" })).toBe("a");
    expect(extractT3Delta({ p: { k: ["content"], v: [{ t: 2, s: "b" }] } })).toBe("b");
    expect(extractT3Delta({ done: true })).toBe("__DONE__");
  });

  it("posts Cookie auth and converts non-streaming T3 SSE to OpenAI JSON", async () => {
    const calls = [];
    globalThis.fetch = vi.fn(async (url, opts) => {
      calls.push({ url: String(url), opts });
      return sseResponse([{ text: "hello" }, { text: " t3" }, { done: true }]);
    });

    const result = await new T3WebExecutor().execute({
      model: "gpt-4o",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: false,
      credentials: { apiKey: "t3-auth=abc; convex-session-id=convex" },
    });

    expect(result.response.status).toBe(200);
    expect(calls[0].opts.headers.Cookie).toContain("convex-session-id=convex");
    expect(result.transformedBody).toMatchObject({ model: "gpt-4o", stream: false });
    expect((await result.response.json()).choices[0].message.content).toBe("hello t3");
  });

  it("rejects authenticated T3 validation probes that return 401 or 403", async () => {
    globalThis.fetch = vi.fn(async () => new Response("", { status: 403 }));
    await expect(new T3WebExecutor().testConnection({
      apiKey: "t3-auth=abc; convex-session-id=convex",
    })).resolves.toBe(false);
  });
});

describe("ChatGPT Web executor", () => {
  it("normalizes bare and chunked ChatGPT session cookies", () => {
    expect(buildSessionCookieHeader("abc")).toBe("__Secure-next-auth.session-token=abc");
    expect(buildSessionCookieHeader("Cookie: __Secure-next-auth.session-token.0=a; __Secure-next-auth.session-token.1=b"))
      .toBe("__Secure-next-auth.session-token.0=a; __Secure-next-auth.session-token.1=b");
  });

  it("merges refreshed token chunks without dropping non-session cookies", () => {
    expect(mergeRefreshedCookie(
      "__Secure-next-auth.session-token=old; cf_clearance=keep",
      "__Secure-next-auth.session-token.0=new0; Path=/, __Secure-next-auth.session-token.1=new1; Path=/",
    )).toBe("cf_clearance=keep; __Secure-next-auth.session-token.0=new0; __Secure-next-auth.session-token.1=new1");
  });

  it("folds OpenAI history into a single ChatGPT next-turn body", () => {
    const body = buildChatGptConversationBody([
      { role: "system", content: "Be direct." },
      { role: "user", content: "Earlier" },
      { role: "assistant", content: "Done" },
      { role: "user", content: "Now" },
    ], "gpt-5");
    expect(body.action).toBe("next");
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].author.role).toBe("system");
    expect(body.messages[1].content.parts[0]).toBe("Now");
    expect(body.history_and_training_disabled).toBe(true);
  });

  it("builds Sentinel tokens automatically and reaches ChatGPT conversation with ordinary session credentials", async () => {
    const calls = [];
    globalThis.fetch = vi.fn(async (url, opts = {}) => {
      calls.push({ url: String(url), opts });
      if (String(url).endsWith("/api/auth/session")) {
        return new Response(JSON.stringify({
          accessToken: "access-token-auto-sentinel",
          expires: new Date(Date.now() + 60000).toISOString(),
          user: { id: "user-1" },
        }), { status: 200 });
      }
      if (String(url) === "https://chatgpt.com/") {
        return new Response('<html data-build="prod-test"><script src="https://cdn.oaistatic.com/main.js"></script></html>', { status: 200 });
      }
      if (String(url).endsWith("/backend-api/sentinel/chat-requirements/prepare")) {
        return new Response(JSON.stringify({ prepare_token: "prepare-token" }), { status: 200 });
      }
      if (String(url).endsWith("/backend-api/sentinel/chat-requirements")) {
        return new Response(JSON.stringify({
          token: "requirements-token",
          proofofwork: { required: false },
          turnstile: { required: true },
        }), { status: 200 });
      }
      return sseResponse([
        { message: { content: { parts: ["hello"] } } },
        { type: "message_stream_complete" },
      ]);
    });

    const result = await new ChatGptWebExecutor().execute({
      model: "gpt-5",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: false,
      credentials: { apiKey: "__Secure-next-auth.session-token=session" },
    });

    expect(result.response.status).toBe(200);
    expect(calls.map((call) => call.url)).toEqual([
      "https://chatgpt.com/api/auth/session",
      "https://chatgpt.com/",
      "https://chatgpt.com/backend-api/sentinel/chat-requirements/prepare",
      "https://chatgpt.com/backend-api/sentinel/chat-requirements",
      "https://chatgpt.com/backend-api/f/conversation",
    ]);
    expect(result.headers.Authorization).toBe("Bearer access-token-auto-sentinel");
    expect(result.headers["openai-sentinel-chat-requirements-token"]).toBe("requirements-token");
    expect(result.headers["openai-sentinel-chat-requirements-prepare-token"]).toBe("prepare-token");
    expect(result.transformedBody.action).toBe("next");
    expect((await result.response.json()).choices[0].message.content).toBe("hello");
    expect(result.response.status).not.toBe(501);
  });

  it("sends a computed proof token when ChatGPT Sentinel requires PoW", async () => {
    const calls = [];
    globalThis.fetch = vi.fn(async (url, opts = {}) => {
      calls.push({ url: String(url), opts });
      if (String(url).endsWith("/api/auth/session")) {
        return new Response(JSON.stringify({
          accessToken: "access-token-pow",
          expires: new Date(Date.now() + 60000).toISOString(),
        }), { status: 200 });
      }
      if (String(url).endsWith("/backend-api/sentinel/chat-requirements/prepare")) {
        return new Response(JSON.stringify({ prepare_token: "prepare-token-pow" }), { status: 200 });
      }
      if (String(url).endsWith("/backend-api/sentinel/chat-requirements")) {
        return new Response(JSON.stringify({
          token: "requirements-token-pow",
          proofofwork: { required: true, seed: "deadbeef", difficulty: "fffff" },
        }), { status: 200 });
      }
      return sseResponse([{ message: { status: "finished_successfully", content: { parts: ["pow ok"] } } }]);
    });

    const result = await new ChatGptWebExecutor().execute({
      model: "gpt-5",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: false,
      credentials: {
        apiKey: "__Secure-next-auth.session-token=session-pow",
        providerSpecificData: { turnstileToken: "turnstile-from-browser" },
      },
    });

    const conversation = calls.find((call) => call.url.endsWith("/backend-api/f/conversation"));
    expect(result.response.status).toBe(200);
    expect(conversation.opts.headers["openai-sentinel-chat-requirements-token"]).toBe("requirements-token-pow");
    expect(conversation.opts.headers["openai-sentinel-proof-token"]).toMatch(/^gAAAAAB/);
    expect(conversation.opts.headers["openai-sentinel-turnstile-token"]).toBe("turnstile-from-browser");
    expect((await result.response.json()).choices[0].message.content).toBe("pow ok");
  });

  it("testConnection validates the ChatGPT session exchange without probing OpenAI-compatible /models", async () => {
    const calls = [];
    globalThis.fetch = vi.fn(async (url) => {
      calls.push(String(url));
      return new Response(JSON.stringify({
        accessToken: "access-token-test-connection",
        expires: new Date(Date.now() + 60000).toISOString(),
      }), { status: 200 });
    });

    await expect(new ChatGptWebExecutor().testConnection({
      apiKey: "__Secure-next-auth.session-token=session-test-connection",
    })).resolves.toBe(true);
    expect(calls).toEqual(["https://chatgpt.com/api/auth/session"]);
  });

  it("surfaces refreshed ChatGPT cookies through onCredentialsRefreshed", async () => {
    const onCredentialsRefreshed = vi.fn();
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      accessToken: "access-token-refresh",
      expires: new Date(Date.now() + 60000).toISOString(),
    }), {
      status: 200,
      headers: {
        "set-cookie": "__Secure-next-auth.session-token.0=new0; Path=/, __Secure-next-auth.session-token.1=new1; Path=/",
      },
    }));

    await new ChatGptWebExecutor().execute({
      model: "gpt-5",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: false,
      credentials: { apiKey: "__Secure-next-auth.session-token=session-refresh" },
      onCredentialsRefreshed,
    });

    expect(onCredentialsRefreshed).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: "__Secure-next-auth.session-token.0=new0; __Secure-next-auth.session-token.1=new1",
    }));
  });

  it("uses supplied ChatGPT sentinel tokens to attempt and convert a non-streaming chat request", async () => {
    const calls = [];
    globalThis.fetch = vi.fn(async (url, opts) => {
      calls.push({ url: String(url), opts });
      if (String(url).endsWith("/api/auth/session")) {
        return new Response(JSON.stringify({
          accessToken: "access-token-2",
          expires: new Date(Date.now() + 60000).toISOString(),
          user: { id: "user-2" },
        }), { status: 200 });
      }
      return sseResponse([
        { message: { content: { parts: ["hello"] } } },
        { message: { content: { parts: ["hello chatgpt"] } } },
        { type: "message_stream_complete" },
      ]);
    });

    const result = await new ChatGptWebExecutor().execute({
      model: "gpt-5",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: false,
      credentials: {
        apiKey: "__Secure-next-auth.session-token=session-2",
        providerSpecificData: { chatgptWebSentinel: { proofToken: "proof" } },
      },
    });

    expect(result.response.status).toBe(200);
    expect(calls[1].opts.headers["openai-sentinel-proof-token"]).toBe("proof");
    expect((await result.response.json()).choices[0].message.content).toBe("hello chatgpt");
  });

  it("keeps final ChatGPT content when finished_successfully arrives without a trailing blank frame", async () => {
    globalThis.fetch = vi.fn(async (url) => {
      if (String(url).endsWith("/api/auth/session")) {
        return new Response(JSON.stringify({
          accessToken: "access-token-3",
          expires: new Date(Date.now() + 60000).toISOString(),
        }), { status: 200 });
      }
      return rawStreamResponse(`data: ${JSON.stringify({
        message: { status: "finished_successfully", content: { parts: ["final answer"] } },
      })}`);
    });

    const result = await new ChatGptWebExecutor().execute({
      model: "gpt-5",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: false,
      credentials: {
        apiKey: "__Secure-next-auth.session-token=session-3",
        providerSpecificData: { chatgptWebSentinel: { proofToken: "proof" } },
      },
    });

    expect((await result.response.json()).choices[0].message.content).toBe("final answer");
  });
});

describe("provider validation and refresh integration", () => {
  it("validates chatgpt-web through session exchange instead of generic OpenAI probes", async () => {
    const calls = [];
    globalThis.fetch = vi.fn(async (url) => {
      calls.push(String(url));
      return new Response(JSON.stringify({
        accessToken: "access-token-route-validation",
        expires: new Date(Date.now() + 60000).toISOString(),
      }), { status: 200 });
    });

    const { POST } = await import("../../src/app/api/providers/validate/route.js");
    const response = await POST(new Request("http://localhost/api/providers/validate", {
      method: "POST",
      body: JSON.stringify({
        provider: "chatgpt-web",
        apiKey: "__Secure-next-auth.session-token=session-route-validation",
      }),
    }));

    await expect(response.json()).resolves.toMatchObject({ valid: true, error: null });
    expect(calls).toEqual(["https://chatgpt.com/api/auth/session"]);
  });

  it("keeps provider test and executor refresh plumbing wired", () => {
    const root = join(import.meta.dirname, "../..");
    const testUtils = readFileSync(join(root, "src/app/api/providers/[id]/test/testUtils.js"), "utf8");
    expect(testUtils).toContain('case "adapta-web":');
    expect(testUtils).toContain('case "chatgpt-web":');
    expect(testUtils).toContain('case "t3-web":');
    expect(testUtils).toContain("executor.testConnection");

    const chatCore = readFileSync(join(root, "open-sse/handlers/chatCore.js"), "utf8");
    expect(chatCore.match(/executor\.execute\(\{[^}]*onCredentialsRefreshed/gs)).toHaveLength(2);

    const translatorSend = readFileSync(join(root, "src/app/api/translator/send/route.js"), "utf8");
    expect(translatorSend).toContain("if (newCredentials.apiKey) updateData.apiKey = newCredentials.apiKey;");
    expect(translatorSend.match(/executor\.execute\(\{[^}]*onCredentialsRefreshed/gs)).toHaveLength(2);
  });
});
