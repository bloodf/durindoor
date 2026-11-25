import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { spawn, page } = vi.hoisted(() => ({ spawn: vi.fn(), page: { current: null } }));
vi.mock("node:child_process", async (original) => ({ ...(await original()), spawn }));
vi.mock("playwright", () => ({
  chromium: {
    launch: async () => ({
      newContext: async () => ({
        addCookies: async () => {},
        newPage: async () => page.current,
        cookies: async () => [],
        close: async () => {}
      }),
      isConnected: () => true,
      on() {},
      close: async () => {}
    })
  }
}));

import { __setOriginalFetchForTesting } from "../../open-sse/utils/proxyFetch.js";
import { ChatGptWebExecutor } from "../../open-sse/executors/chatgpt-web.js";
import { CloudflarePlaygroundExecutor } from "../../open-sse/executors/cloudflare-playground.js";
import { CursorExecutor } from "../../open-sse/executors/cursor.js";
import { DeepSeekWebExecutor } from "../../open-sse/executors/deepseek-web.js";
import { DevinCliAgenticExecutor } from "../../open-sse/executors/devin-cli-agentic.js";
import { DevinCliExecutor } from "../../open-sse/executors/devin-cli.js";
import { DevinDesktopExecutor, DEVIN_DESKTOP_AUTH_URL, DEVIN_DESKTOP_OPT_IN_KEY } from "../../open-sse/executors/devin-desktop.js";
import { DoubaoWebExecutor } from "../../open-sse/executors/doubao-web.js";
import { DuckDuckGoWebExecutor } from "../../open-sse/executors/duckduckgo-web.js";
import { FreebuffExecutor, FREEBUFF_CHAT_URL } from "../../open-sse/executors/freebuff.js";
import { GeminiWebExecutor, resetGeminiBrowserLeaseForTests } from "../../open-sse/executors/gemini-web.js";
import { GrokWebExecutor } from "../../open-sse/executors/grok-web.js";
import { FREEBUFF_OPT_IN_KEY } from "../../open-sse/config/freebuff.js";
import { QuotaDispatchUnavailableError } from "../../open-sse/services/quota/dispatch.js";
import {
  runWithProviderAttemptContext,
  settleProviderAttemptDispatch
} from "../../open-sse/services/providerAttemptContext.js";

const messages = [{ role: "user", content: "hi" }];

let sends;
let restoreFetch;
let fetch;
let home;

beforeEach(() => {
  sends = [];
  fetch = vi.fn(async (url) => { throw new Error(`unexpected fetch ${url}`); });
  restoreFetch = __setOriginalFetchForTesting(fetch);
  home = mkdtempSync(path.join(tmpdir(), "send-4-"));
});

afterEach(async () => {
  restoreFetch();
  spawn.mockReset();
  vi.unstubAllEnvs();
  await resetGeminiBrowserLeaseForTests();
  rmSync(home, { recursive: true, force: true });
});

/** Answer HTTP requests by URL, recording each one as a physical send. */
function serve(route) {
  fetch.mockImplementation(async (url, options) => {
    sends.push({ url: String(url), options });
    return route(String(url));
  });
}

const sse = (text) => new Response(text, { headers: { "content-type": "text/event-stream" } });

/** A closed ACP child that answers each JSON-RPC request. */
function acpChild() {
  sends.push({ url: "spawn" });
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  const reply = (message) => queueMicrotask(() => child.stdout.emit("data", Buffer.from(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`)));
  child.stdin = Object.assign(new EventEmitter(), {
    destroyed: false,
    end() {},
    write(line) {
      const { id, method } = JSON.parse(line);
      if (method === "initialize") reply({ id, result: { protocolVersion: 1 } });
      if (method === "session/new") reply({ id, result: { sessionId: "s1" } });
      if (method === "session/prompt") {
        reply({ method: "session/update", params: { sessionId: "s1", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hi" } } } });
        reply({ id, result: { stopReason: "end_turn" } });
      }
    }
  });
  child.kill = () => {};
  return child;
}

/** A closed Gemini page: submitting the prompt delivers the StreamGenerate reply. */
function geminiPage() {
  let onResponse;
  const inner = JSON.stringify([null, null, null, null, [["rc_1", ["hi"]]]]);
  return {
    on: (event, handler) => { onResponse = handler; },
    goto: async () => ({ status: () => 200 }),
    url: () => "https://gemini.google.com/app",
    waitForSelector: async () => ({ click: async () => {} }),
    waitForTimeout: async () => {},
    keyboard: {
      insertText: async () => {},
      press: async () => {
        sends.push({ url: "prompt" });
        await onResponse({
          url: () => "https://gemini.google.com/_/StreamGenerate",
          status: () => 200,
          text: async () => `)]}'\n\n${JSON.stringify([["wrb.fr", null, inner]])}\n`
        });
      }
    }
  };
}

function cursorExecutor() {
  vi.stubEnv("CURSOR_AGENT_SERVICE", "off");
  const executor = new CursorExecutor();
  const text = Buffer.from([0x12, 0x04, 0x0a, 0x02, 0x68, 0x69]);
  const header = Buffer.alloc(5);
  header.writeUInt32BE(text.length, 1);
  serve(() => new Response(Buffer.concat([header, text])));
  return executor;
}

// `attempts` counts physical dispatches, including uncharged setup requests.
// `unchargedFirst` of them still happen when the quota-bearing send is denied.
const cases = [
  {
    name: "chatgpt-web",
    attempts: 1,
    unchargedFirst: 0,
    setup: () => new ChatGptWebExecutor({
      browser: {
        createSession: async () => ({}),
        runTurn: async () => { sends.push({ url: "turn" }); return { text: "hi" }; },
        readSessionCookies: async () => []
      }
    }),
    input: () => ({ model: "gpt-5-6", credentials: { apiKey: "__Secure-next-auth.session-token=t", connectionId: "c1" } })
  },
  {
    name: "cloudflare-playground",
    attempts: 1,
    unchargedFirst: 0,
    setup: () => new CloudflarePlaygroundExecutor((id) => ({
      start: async () => { sends.push({ url: "socket" }); return { ok: true }; },
      async *frames() {
        yield JSON.stringify({ type: "cf_agent_use_chat_response", id, body: JSON.stringify({ type: "text-delta", delta: "hi" }), done: true });
      },
      close: async () => {}
    })),
    input: () => ({ model: "zai-org/glm-4.7-flash" })
  },
  {
    name: "cursor",
    attempts: 1,
    unchargedFirst: 0,
    setup: cursorExecutor,
    input: () => ({ model: "cursor-model", proxyOptions: { disableEnvProxy: false, vercelRelayUrl: "https://relay.example.invalid" }, credentials: { accessToken: "token", providerSpecificData: { machineId: "machine" } } })
  },
  {
    name: "deepseek-web",
    attempts: 3,
    unchargedFirst: 2,
    // An aborted DeepSeek request has always answered 499 instead of throwing.
    abortedStatus: 499,
    setup() {
      serve((url) => {
        if (url.endsWith("/users/current")) return Response.json({ data: { biz_data: { token: "access" } } });
        if (url.endsWith("/chat_session/create")) return Response.json({ data: { biz_data: { chat_session: { id: "s1" } } } });
        return sse(`data: ${JSON.stringify({ data: { biz_data: { response: "hi" } } })}\n\n`);
      });
      return new DeepSeekWebExecutor();
    },
    input: () => ({ model: "deepseek-chat", credentials: { apiKey: "token" } })
  },
  {
    name: "devin-cli-agentic",
    attempts: 1,
    unchargedFirst: 0,
    // An aborted turn has always answered 499 instead of throwing.
    abortedStatus: 499,
    setup() {
      vi.stubEnv("DEVIN_AGENTIC_HOME", home);
      vi.stubEnv("CLI_DEVIN_BIN", "/offline/devin");
      spawn.mockImplementation(acpChild);
      return new DevinCliAgenticExecutor();
    },
    input: () => ({ model: "adaptive" })
  },
  {
    name: "devin-cli",
    attempts: 1,
    unchargedFirst: 0,
    setup() {
      vi.stubEnv("CLI_DEVIN_BIN", "/offline/devin");
      spawn.mockImplementation(acpChild);
      return new DevinCliExecutor();
    },
    input: () => ({ model: "fixture-model" })
  },
  {
    name: "devin-desktop",
    attempts: 2,
    unchargedFirst: 1,
    // The reply is a binary Connect stream; an empty-bodied 401 is enough to follow the ticket.
    status: 401,
    setup() {
      // GetUserJwt answers protobuf field 1 (the JWT) as a length-delimited string.
      serve((url) => url === DEVIN_DESKTOP_AUTH_URL
        ? new Response(new Uint8Array([0x0a, 0x03, 0x6a, 0x77, 0x74]))
        : new Response("{}", { status: 401 }));
      return new DevinDesktopExecutor();
    },
    input: () => ({ model: "swe-1-7", credentials: { apiKey: "token", providerSpecificData: { [DEVIN_DESKTOP_OPT_IN_KEY]: true } } })
  },
  {
    name: "doubao-web",
    attempts: 1,
    unchargedFirst: 0,
    setup() {
      serve(() => sse(`data: ${JSON.stringify({ content: { content_block: [{ content: { text_block: { text: "hi" } } }] } })}\n\n`));
      return new DoubaoWebExecutor();
    },
    input: () => ({ model: "dola-speed", credentials: { apiKey: "sessionid=s; s_v_web_id=v" } })
  },
  {
    name: "duckduckgo-web",
    attempts: 2,
    unchargedFirst: 1,
    setup() {
      serve((url) => url.endsWith("/status")
        ? new Response("{}", { headers: { "x-vqd-4": "vqd" } })
        : sse('data: {"message":"hi"}\ndata: [DONE]\n'));
      return new DuckDuckGoWebExecutor();
    },
    input: () => ({ model: "gpt-4o-mini" })
  },
  {
    name: "freebuff",
    // Session, run start, chat, then the background run finish.
    attempts: 4,
    unchargedFirst: 3,
    setup() {
      serve((url) => url === FREEBUFF_CHAT_URL
        ? Response.json({ choices: [{ message: { content: "hi" } }] })
        : Response.json({ instanceId: "i1", runId: "r1" }));
      return new FreebuffExecutor();
    },
    input: () => ({ model: "deepseek/deepseek-v4-flash", credentials: { apiKey: "token", providerSpecificData: { [FREEBUFF_OPT_IN_KEY]: true } } })
  },
  {
    name: "gemini-web",
    attempts: 1,
    unchargedFirst: 0,
    // An aborted browser request has always answered 499 instead of throwing.
    abortedStatus: 499,
    setup() {
      page.current = geminiPage();
      return new GeminiWebExecutor();
    },
    input: () => ({ model: "", credentials: { apiKey: "__Secure-1PSID=x" } })
  },
  {
    name: "grok-web",
    attempts: 1,
    unchargedFirst: 0,
    setup() {
      serve(() => new Response(`${JSON.stringify({ result: { response: { modelResponse: { message: "hi" } } } })}\n`));
      return new GrokWebExecutor();
    },
    input: () => ({ model: "grok-4.1-fast", credentials: { apiKey: "sso=tok" } })
  }
];

const request = (input, extra) => ({ stream: false, body: { messages }, ...input(), ...extra });

describe.each(cases)("$name on the shared sender (#2308)", ({ name, attempts, unchargedFirst, abortedStatus, status = 200, setup, input }) => {
  it("charges quota once per send and hands the ticket to the returned response", async () => {
    const executor = setup();
    const ticket = { tracked: true, settle: vi.fn().mockResolvedValue({ changed: true }), release: vi.fn() };
    const beginQuotaDispatch = vi.fn().mockResolvedValue(ticket);
    let clock = 100;
    const onProviderAttempt = vi.fn(() => ++clock);

    const raw = await runWithProviderAttemptContext(onProviderAttempt,
      () => executor.execute(request(input)), { beginQuotaDispatch });
    // ChatGPT Web's browser transport has always returned a bare Response.
    const response = raw.response ?? raw;

    expect(response.status).toBe(status);
    const text = await response.text();
    if (status === 200) expect(text).toContain("hi");
    await vi.waitFor(() => expect(sends).toHaveLength(attempts));
    expect(beginQuotaDispatch).toHaveBeenCalledOnce();
    expect(onProviderAttempt).toHaveBeenCalledTimes(attempts);
    if (name !== "chatgpt-web") {
      // Freebuff's background finish is sent after the chat reply it reports on.
      expect(raw.attemptStartedAt).toBe(name === "freebuff" ? 103 : 100 + attempts);
    }
    await settleProviderAttemptDispatch(response, { success: true });
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

    // Freebuff still finishes the run it opened, in the background.
    await vi.waitFor(() => expect(sends).toHaveLength(unchargedFirst));
  });
});
