import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __setOriginalFetchForTesting } from "../../open-sse/utils/proxyFetch.js";
import { __setTlsFetchOverrideForTesting } from "../../open-sse/services/chatgptTlsClient.js";
import { AdaptaWebExecutor } from "../../open-sse/executors/adapta-web.js";
import { BlackboxWebExecutor } from "../../open-sse/executors/blackbox-web.js";
import { ChatGptWebHttpExecutor, __resetChatGptWebCachesForTesting } from "../../open-sse/executors/chatgpt-web-http.js";
import { ChatPlaygroundExecutor } from "../../open-sse/executors/chatplayground.js";
import { ClaudeWebExecutor } from "../../open-sse/executors/claude-web.js";
import { CliproxyapiExecutor } from "../../open-sse/executors/cliproxyapi.js";
import { CodexAppServerExecutor } from "../../open-sse/executors/codex-app-server.js";
import { ConolWebExecutor } from "../../open-sse/executors/conol-web.js";
import { CopilotM365WebExecutor, __setCopilotM365WebSocketForTesting } from "../../open-sse/executors/copilot-m365-web.js";
import { CopilotWebExecutor, __setCopilotWebSocketForTesting } from "../../open-sse/executors/copilot-web.js";
import { encodeFrame } from "../../open-sse/executors/copilot-m365-frames.js";
import { QuotaDispatchUnavailableError } from "../../open-sse/services/quota/dispatch.js";
import {
  runWithProviderAttemptContext,
  settleProviderAttemptDispatch
} from "../../open-sse/services/providerAttemptContext.js";

vi.mock("@/lib/localDb", () => ({ getSettings: vi.fn(async () => ({})) }));

const messages = [{ role: "user", content: "hi" }];
const jwt = (claims) => `eyJ.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;
const later = () => Math.floor(Date.now() / 1000) + 3600;

let sends;
let restores;
let fetch;

beforeEach(() => {
  sends = [];
  restores = [];
  fetch = vi.fn(async (url) => { throw new Error(`unexpected fetch ${url}`); });
  restores.push(__setOriginalFetchForTesting(fetch));
});

afterEach(() => {
  for (const restore of restores) restore();
  __setTlsFetchOverrideForTesting(null);
  __resetChatGptWebCachesForTesting();
  vi.unstubAllEnvs();
});

/** Answer HTTP requests by URL, recording each one as a physical send. */
function serve(route) {
  fetch.mockImplementation(async (url, options) => {
    sends.push({ url: String(url), options });
    return route(String(url));
  });
}

class FakeSocket extends EventEmitter {
  readyState = 1;
  constructor() {
    super();
    sends.push({ url: "socket" });
    queueMicrotask(() => this.emit("open"));
  }
  close() {}
  later(...frames) {
    queueMicrotask(() => { for (const frame of frames) this.emit("message", frame); });
  }
}

class CopilotSocket extends FakeSocket {
  send(data) {
    if (JSON.parse(data).event !== "send") return;
    this.later(JSON.stringify({ event: "appendText", text: "hi" }), JSON.stringify({ event: "done" }));
  }
}

class M365Socket extends FakeSocket {
  send(data) {
    const frame = JSON.parse(String(data).replace(/\x1e$/, ""));
    if (frame.protocol === "json") this.later(Buffer.from(encodeFrame({})));
    if (frame.type === 4 && frame.target === "chat") {
      this.later(Buffer.from(
        encodeFrame({ type: 1, target: "update", arguments: [{ messages: [{ text: "hi", author: "bot" }] }] }) +
        encodeFrame({ type: 3, invocationId: "0" })
      ));
    }
  }
}

function codexSocket() {
  sends.push({ url: "codex" });
  const socket = new EventEmitter();
  const push = (message) => queueMicrotask(() => socket.emit("message", Buffer.from(JSON.stringify(message))));
  socket.send = (data) => {
    const { id, method } = JSON.parse(data);
    if (method === "initialize") push({ id, result: {} });
    if (method === "thread/start") push({ id, result: { thread: { id: "thr" } } });
    if (method === "turn/start") {
      push({ id, result: { turn: { id: "turn" } } });
      push({ method: "item/agentMessage/delta", params: { delta: "hi" } });
      push({ method: "turn/completed", params: { turn: {} } });
    }
  };
  socket.close = () => {};
  process.nextTick(() => socket.emit("open"));
  return socket;
}

const chatGptSse = 'data: {"message":{"id":"m","author":{"role":"assistant"},"content":{"content_type":"text","parts":["hi"]},"status":"finished_successfully"}}\n\ndata: [DONE]\n\n';

// `attempts` counts physical dispatches, including uncharged setup requests.
// `unchargedFirst` of them still happen when the quota-bearing send is denied.
const cases = [
  {
    name: "adapta-web",
    attempts: 3,
    unchargedFirst: 2,
    // An aborted Adapta request has always answered 499 instead of throwing.
    abortedStatus: 499,
    setup() {
      const token = jwt({ exp: later() });
      serve((url) => {
        if (url.endsWith("/v1/client")) return Response.json({ response: { sessions: [{ id: "s1", status: "active" }] } });
        if (url.endsWith("/tokens")) return Response.json({ jwt: token });
        return new Response('data: {"type":"text-delta","delta":"hi"}\n\ndata: {"type":"done"}\n\n');
      });
      return new AdaptaWebExecutor();
    },
    // A fresh cookie per call keeps the session cache out of the attempt count.
    input: () => ({ model: "adapta-one", proxyOptions: { disableEnvProxy: true }, credentials: { apiKey: `cookie-${Math.random()}` } })
  },
  {
    name: "blackbox-web",
    attempts: 3,
    unchargedFirst: 2,
    setup() {
      serve((url) => {
        if (url.endsWith("/api/auth/session")) return Response.json({ user: { email: "a@example.invalid" } });
        if (url.endsWith("/api/check-subscription")) return Response.json({});
        return new Response("hi");
      });
      return new BlackboxWebExecutor();
    },
    input: () => ({ model: "gpt-4", credentials: { apiKey: "session" } })
  },
  {
    name: "chatgpt-web-http",
    attempts: 7,
    unchargedFirst: 6,
    setup() {
      __setTlsFetchOverrideForTesting(async (url, options) => {
        sends.push({ url, options });
        const path = new URL(url).pathname;
        const reply = (text) => ({ status: 200, text, headers: new Headers(), body: null });
        if (path === "/api/auth/session") return reply('{"accessToken":"access"}');
        if (path.includes("chat-requirements")) return reply('{"token":"requirements"}');
        if (path === "/backend-api/conversation" || path === "/backend-api/f/conversation") return reply(chatGptSse);
        return reply("<html></html>");
      });
      return new ChatGptWebHttpExecutor();
    },
    input: () => ({ model: "instant", credentials: { apiKey: "cookie" } })
  },
  {
    name: "chatplayground",
    attempts: 3,
    unchargedFirst: 2,
    setup() {
      serve((url) => {
        if (url.endsWith("/api/me")) return Response.json({});
        if (url.endsWith("/api/models")) return Response.json([{ slug: "bot" }]);
        return new Response('data: {"type":"text-delta","delta":"hi"}\n\ndata: {"type":"finish","finishReason":"stop"}\n\n');
      });
      return new ChatPlaygroundExecutor();
    },
    input: () => ({ model: "bot", credentials: { apiKey: jwt({}) } })
  },
  {
    name: "claude-web",
    attempts: 2,
    unchargedFirst: 1,
    setup() {
      serve((url) => url.endsWith("/organizations")
        ? Response.json([{ uuid: "org" }])
        : new Response('data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hi"}}\n\n'));
      return new ClaudeWebExecutor();
    },
    input: () => ({ model: "claude-sonnet-4-6", credentials: { apiKey: "sessionKey=k" } })
  },
  {
    name: "cliproxyapi",
    attempts: 1,
    unchargedFirst: 0,
    setup() {
      serve(() => Response.json({ choices: [{ message: { content: "hi" } }] }));
      return new CliproxyapiExecutor();
    },
    input: () => ({ model: "gpt-4.1", credentials: { apiKey: "key" } })
  },
  {
    name: "codex-app-server",
    attempts: 1,
    unchargedFirst: 0,
    // An aborted turn has always answered with an empty, terminated stream.
    abortedStatus: 200,
    setup() {
      vi.stubEnv("DURINDOOR_CODEX_APPSERVER_WS", "ws://127.0.0.1:9");
      vi.stubEnv("DURINDOOR_CODEX_APPSERVER_WS_TOKEN", "token");
      return new CodexAppServerExecutor({ webSocketFactory: codexSocket });
    },
    input: () => ({ model: "gpt-5.4" })
  },
  {
    name: "conol-web",
    attempts: 6,
    unchargedFirst: 4,
    setup() {
      serve((url) => {
        if (url.endsWith("/api/sessions")) return Response.json({ sessionId: "s1" });
        if (url.endsWith("/model") || url.endsWith("/messages")) return Response.json({});
        return new Response('data: {"type":"assistant","text":"hi"}\n\n');
      });
      return new ConolWebExecutor();
    },
    input: () => ({ model: "claude-sonnet-5", credentials: { apiKey: "session" } })
  },
  {
    name: "copilot-m365-web",
    attempts: 1,
    unchargedFirst: 0,
    setup() {
      restores.push(__setCopilotM365WebSocketForTesting(M365Socket));
      return new CopilotM365WebExecutor();
    },
    input: () => ({ model: "copilot-m365", credentials: { apiKey: "access_token=token; chathubPath=user@tenant" } })
  },
  {
    name: "copilot-web",
    attempts: 2,
    unchargedFirst: 1,
    setup() {
      serve(() => Response.json({ currentConversationId: "c1" }));
      restores.push(__setCopilotWebSocketForTesting(CopilotSocket));
      return new CopilotWebExecutor();
    },
    input: () => ({ model: "copilot", credentials: { apiKey: "access_token=token" } })
  }
];

const request = (input, extra) => ({ stream: false, body: { messages }, ...input(), ...extra });

describe.each(cases)("$name on the shared sender (#2308)", ({ attempts, unchargedFirst, abortedStatus, setup, input }) => {
  it("charges quota once per send and hands the ticket to the returned response", async () => {
    const executor = setup();
    const ticket = { tracked: true, settle: vi.fn().mockResolvedValue({ changed: true }), release: vi.fn() };
    const beginQuotaDispatch = vi.fn().mockResolvedValue(ticket);
    let clock = 100;
    const onProviderAttempt = vi.fn(() => ++clock);

    const result = await runWithProviderAttemptContext(onProviderAttempt,
      () => executor.execute(request(input)), { beginQuotaDispatch });

    expect(result.response.status).toBe(200);
    expect(await result.response.text()).toContain("hi");
    expect(beginQuotaDispatch).toHaveBeenCalledOnce();
    expect(onProviderAttempt).toHaveBeenCalledTimes(attempts);
    expect(result.attemptStartedAt).toBe(100 + attempts);
    await settleProviderAttemptDispatch(result.response, { success: true });
    expect(ticket.settle).toHaveBeenCalledOnce();
  });

  it("honours a pre-aborted signal without sending or charging", async () => {
    const executor = setup();
    const beginQuotaDispatch = vi.fn();
    const pending = runWithProviderAttemptContext(() => 1,
      () => executor.execute(request(input, { signal: AbortSignal.abort() })), { beginQuotaDispatch });

    if (abortedStatus) {
      const { response } = await pending;
      expect(response.status).toBe(abortedStatus);
      await response.text();
    } else {
      await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    }
    expect(sends).toEqual([]);
    expect(beginQuotaDispatch).not.toHaveBeenCalled();
  });

  it("surfaces a local quota denial without making the billable send", async () => {
    const executor = setup();
    const beginQuotaDispatch = vi.fn().mockRejectedValue(new QuotaDispatchUnavailableError());

    await expect(runWithProviderAttemptContext(() => 1,
      () => executor.execute(request(input)), { beginQuotaDispatch }))
      .rejects.toMatchObject({ code: "QUOTA_DISPATCH_UNAVAILABLE" });

    expect(sends).toHaveLength(unchargedFirst);
  });
});

describe("Microsoft 365 Copilot streaming (#2308)", () => {
  const input = () => ({ model: "copilot-m365", credentials: { apiKey: "access_token=token; chathubPath=user@tenant" } });

  it("charges the streamed turn once and rejects on a quota denial", async () => {
    restores.push(__setCopilotM365WebSocketForTesting(M365Socket));
    const executor = new CopilotM365WebExecutor();
    const ticket = { tracked: true, settle: vi.fn().mockResolvedValue({ changed: true }), release: vi.fn() };
    const beginQuotaDispatch = vi.fn().mockResolvedValueOnce(ticket)
      .mockRejectedValueOnce(new QuotaDispatchUnavailableError());
    const run = () => runWithProviderAttemptContext(() => 1,
      () => executor.execute(request(input, { stream: true })), { beginQuotaDispatch });

    const { response } = await run();
    expect(await response.text()).toContain("hi");
    await settleProviderAttemptDispatch(response, { success: true });
    expect(ticket.settle).toHaveBeenCalledOnce();
    await expect(run()).rejects.toMatchObject({ code: "QUOTA_DISPATCH_UNAVAILABLE" });
  });
});
