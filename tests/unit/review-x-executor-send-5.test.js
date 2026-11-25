import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __setOriginalFetchForTesting } from "../../open-sse/utils/proxyFetch.js";
import { HuggingChatExecutor } from "../../open-sse/executors/huggingchat.js";
import { HyperAgentExecutor } from "../../open-sse/executors/hyperagent.js";
import { KimiWebExecutor } from "../../open-sse/executors/kimi-web.js";
import { LmarenaExecutor } from "../../open-sse/executors/lmarena.js";
import { MaxaiExecutor } from "../../open-sse/executors/maxai.js";
import { MimoFreeExecutor, __test__ as mimo } from "../../open-sse/executors/mimo-free.js";
import {
  MuseSparkWebExecutor,
  __setMuseSparkFreshTokenFetcherForTesting,
  __setMuseSparkWebSocketForTesting
} from "../../open-sse/executors/muse-spark-web.js";
import { NotionWebExecutor } from "../../open-sse/executors/notion-web.js";
import { NotrackWebExecutor } from "../../open-sse/executors/notrack-web.js";
import { OneMinAiExecutor } from "../../open-sse/executors/oneminai.js";
import { PerplexityWebExecutor } from "../../open-sse/executors/perplexity-web.js";
import { __setTlsFetchOverrideForTesting } from "../../open-sse/services/lmarenaTlsClient.js";
import { QuotaDispatchUnavailableError } from "../../open-sse/services/quota/dispatch.js";
import {
  runWithProviderAttemptContext,
  settleProviderAttemptDispatch
} from "../../open-sse/services/providerAttemptContext.js";

const messages = [{ role: "user", content: "hi" }];

let sends;
let restoreFetch;
let fetch;
let restoreSocket;

beforeEach(() => {
  sends = [];
  fetch = vi.fn(async (url) => { throw new Error(`unexpected fetch ${url}`); });
  restoreFetch = __setOriginalFetchForTesting(fetch);
});

afterEach(() => {
  restoreFetch();
  restoreSocket?.();
  restoreSocket = undefined;
  __setTlsFetchOverrideForTesting(null);
  __setMuseSparkFreshTokenFetcherForTesting(undefined);
  mimo.resetJwtCache();
});

/** Answer HTTP requests by URL, recording each one as a physical send. */
function serve(route) {
  fetch.mockImplementation(async (url, options) => {
    sends.push({ url: String(url), options });
    return route(String(url), options);
  });
}

const sse = (...events) => new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
  headers: { "content-type": "text/event-stream" }
});

function connectFrame(value) {
  const json = Buffer.from(JSON.stringify(value));
  const header = Buffer.alloc(5);
  header.writeUInt32BE(json.length, 1);
  return Buffer.concat([header, json]);
}

class FakeSocket {
  constructor() {
    sends.push({ url: "socket" });
    this.frames = 0;
    queueMicrotask(() => this.onopen());
  }
  send() {
    if (++this.frames !== 2) return;
    queueMicrotask(() => {
      this.onmessage({ data: JSON.stringify({ type: "full", response: { sections: [{ view_model: { primitive: { text: "hi" } } }] } }) });
      this.onclose({ code: 1000 });
    });
  }
  on() {}
  close() {}
}

// `attempts` counts physical dispatches, including uncharged setup requests.
// `unchargedFirst` of them still happen when the quota-bearing send is denied.
const cases = [
  {
    name: "huggingchat",
    attempts: 3,
    unchargedFirst: 2,
    setup() {
      serve((url) => {
        if (url.endsWith("/chat/conversation")) return Response.json({ conversationId: "c1" });
        if (url.includes("/api/v2/conversations/")) return Response.json({ json: { rootMessageId: "m1" } });
        return new Response(`${JSON.stringify({ type: "stream", token: "hi" })}\n${JSON.stringify({ type: "finalAnswer", text: "hi" })}\n`);
      });
      return new HuggingChatExecutor();
    },
    input: () => ({ model: "fixture/model", credentials: { apiKey: "hf-chat=s" } })
  },
  {
    name: "hyperagent",
    attempts: 3,
    unchargedFirst: 2,
    setup() {
      serve((url) => {
        if (url.endsWith("/api/threads")) return Response.json({ id: "thread_send5_0001" });
        if (url.endsWith("/chat")) return sse({ type: "text", content: "hi" });
        return Response.json({ ok: true });
      });
      return new HyperAgentExecutor();
    },
    input: () => ({ model: "sonnet-latest", credentials: { apiKey: "session=s" } })
  },
  {
    name: "kimi-web",
    attempts: 1,
    unchargedFirst: 0,
    setup() {
      serve(() => new Response(Buffer.concat([
        connectFrame({ op: "append", mask: "block.text.content", block: { text: { content: "hi" } } }),
        connectFrame({ message: { status: "MESSAGE_STATUS_COMPLETED", role: "assistant" } })
      ])));
      return new KimiWebExecutor();
    },
    input: () => ({ model: "k2d6", credentials: { apiKey: "kimi-auth=eyJ.test" } })
  },
  {
    name: "lmarena",
    attempts: 1,
    unchargedFirst: 0,
    setup() {
      __setTlsFetchOverrideForTesting(async () => {
        sends.push({ url: "tls" });
        return { status: 200, headers: new Headers(), text: 'data: {"text":"hi"}\n', body: null };
      });
      return new LmarenaExecutor();
    },
    input: () => ({ model: "gpt-oss-120b", credentials: { cookie: "arena=s" } })
  },
  {
    name: "maxai",
    attempts: 1,
    unchargedFirst: 0,
    setup() {
      serve(() => sse({ text: "hi" }));
      return new MaxaiExecutor();
    },
    input: () => ({
      model: "gpt-4o",
      credentials: {
        providerSpecificData: {
          maxaiAccessToken: "t",
          maxaiDeviceId: "d",
          maxaiUserId: "u",
          maxaiSigningConstants: { hmacKey: "k", aesKey: "a", appVersion: "webpage_1.0.0", ctxKey: "c" }
        }
      }
    })
  },
  {
    name: "mimo-free",
    attempts: 2,
    unchargedFirst: 1,
    setup() {
      serve((url) => url === mimo.BOOTSTRAP_URL
        ? Response.json({ jwt: "j" })
        : Response.json({ choices: [{ message: { content: "hi" } }] }));
      return new MimoFreeExecutor();
    },
    input: () => ({ model: "mimo-auto", credentials: {} })
  },
  {
    name: "muse-spark-web",
    // Warmup and mode switch over HTTP, then the WebSocket turn.
    attempts: 3,
    unchargedFirst: 2,
    // The setup calls replace the global fetch the way a plain test stub would.
    setup() {
      serve(() => new Response("{}"));
      __setMuseSparkFreshTokenFetcherForTesting(async () => ({ ok: true, token: "ecto1:t" }));
      restoreSocket = __setMuseSparkWebSocketForTesting(FakeSocket);
      return new MuseSparkWebExecutor();
    },
    input: () => ({ model: "muse-spark", credentials: { apiKey: "ecto_1_sess=s", providerSpecificData: { enableSessionDispatch: true } } })
  },
  {
    name: "notion-web",
    attempts: 2,
    unchargedFirst: 1,
    setup() {
      serve((url) => url.endsWith("getAvailableModels")
        ? Response.json({ models: [] })
        : new Response('{"value":{"text":"hi"}}\n'));
      return new NotionWebExecutor();
    },
    input: () => ({ model: "notion-ai", credentials: { apiKey: "token_v2=s; space_id=space; notion_user_id=user" } })
  },
  {
    name: "notrack-web",
    attempts: 1,
    unchargedFirst: 0,
    setup() {
      serve(() => sse({ type: "delta", chunk: "hi" }));
      return new NotrackWebExecutor();
    },
    input: () => ({ model: "notrack-c", credentials: { apiKey: "uid=u; si_usr_id=i; si_ses_id=s" } })
  },
  {
    name: "oneminai",
    attempts: 1,
    unchargedFirst: 0,
    setup() {
      serve(() => Response.json({ aiRecord: { aiRecordDetail: { resultObject: ["hi"] } } }));
      return new OneMinAiExecutor();
    },
    input: () => ({ model: "gpt-4o-mini", credentials: { apiKey: "key" } })
  },
  {
    name: "perplexity-web",
    attempts: 1,
    unchargedFirst: 0,
    setup() {
      serve(() => sse({ text: "hi", status: "COMPLETED" }));
      return new PerplexityWebExecutor();
    },
    input: () => ({ model: "pplx-auto", credentials: { apiKey: "session" } })
  }
];

const request = (input, extra) => ({ stream: false, body: { messages }, ...input(), ...extra });

const trackedTicket = () => ({ tracked: true, settle: vi.fn().mockResolvedValue({ changed: true }), release: vi.fn() });

describe.each(cases)("$name on the shared sender (#2308)", ({ attempts, unchargedFirst, setup, input }) => {
  it("charges quota once per send and hands the ticket to the returned response", async () => {
    const executor = setup();
    const ticket = trackedTicket();
    const beginQuotaDispatch = vi.fn().mockResolvedValue(ticket);
    let clock = 100;
    const onProviderAttempt = vi.fn(() => ++clock);

    const result = await runWithProviderAttemptContext(onProviderAttempt,
      () => executor.execute(request(input)), { beginQuotaDispatch });

    expect(result.response.status).toBe(200);
    expect(await result.response.text()).toContain("hi");
    expect(sends).toHaveLength(attempts);
    expect(beginQuotaDispatch).toHaveBeenCalledOnce();
    expect(onProviderAttempt).toHaveBeenCalledTimes(attempts);
    expect(result.attemptStartedAt).toBe(100 + attempts);
    await settleProviderAttemptDispatch(result.response, { success: true });
    expect(ticket.settle).toHaveBeenCalledOnce();
  });

  it("honours a pre-aborted signal without sending or charging", async () => {
    const executor = setup();
    const beginQuotaDispatch = vi.fn();

    await expect(runWithProviderAttemptContext(() => 1,
      () => executor.execute(request(input, { signal: AbortSignal.abort() })), { beginQuotaDispatch }))
      .rejects.toMatchObject({ name: "AbortError" });

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

describe("resends settle the discarded attempt first (#2308)", () => {
  it("mimo-free settles the rejected chat before re-sending with a fresh JWT", async () => {
    let chats = 0;
    serve((url) => {
      if (url === mimo.BOOTSTRAP_URL) return Response.json({ jwt: "j" });
      return ++chats === 1 ? new Response("denied", { status: 401 }) : Response.json({ ok: "hi" });
    });
    const [first, second] = [trackedTicket(), trackedTicket()];
    const beginQuotaDispatch = vi.fn().mockResolvedValueOnce(first).mockImplementationOnce(async () => {
      expect(first.settle).toHaveBeenCalledWith({ success: false, reason: "fallback" });
      return second;
    });

    const result = await runWithProviderAttemptContext(() => 1,
      () => new MimoFreeExecutor().execute(request(() => ({ model: "mimo-auto", credentials: {} }))), { beginQuotaDispatch });

    expect(result.response.status).toBe(200);
    await settleProviderAttemptDispatch(result.response, { success: true });
    expect(second.settle).toHaveBeenCalledOnce();
  });

});
