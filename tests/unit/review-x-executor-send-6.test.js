import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../open-sse/services/qoderModels.js", () => ({
  getQoderModelConfig: vi.fn(async () => ({ key: "auto", source: "system" })),
  resolveQoderModels: vi.fn(async () => null)
}));

import { __setOriginalFetchForTesting } from "../../open-sse/utils/proxyFetch.js";
import { QoderExecutor } from "../../open-sse/executors/qoder.js";
import { T3ChatWebExecutor } from "../../open-sse/executors/t3-chat-web.js";
import { TencentAIStudioWebExecutor } from "../../open-sse/executors/tencent-aistudio-web.js";
import { TinyCmsExecutor } from "../../open-sse/executors/tinycms-web.js";
import { TwinmindExecutor } from "../../open-sse/executors/twinmind.js";
import { VeoAIFreeWebExecutor } from "../../open-sse/executors/veoaifree-web.js";
import { VertexExecutor } from "../../open-sse/executors/vertex.js";
import { WindsurfExecutor } from "../../open-sse/executors/windsurf.js";
import { YuanbaoWebExecutor } from "../../open-sse/executors/yuanbao-web.js";
import { ZedHostedExecutor } from "../../open-sse/executors/zed-hosted.js";
import { ZenmuxFreeExecutor } from "../../open-sse/executors/zenmux-free.js";
import { clearZedCaches } from "../../open-sse/shared/zedHostedAuth.js";
import { QuotaDispatchUnavailableError } from "../../open-sse/services/quota/dispatch.js";
import {
  runWithProviderAttemptContext,
  settleProviderAttemptDispatch
} from "../../open-sse/services/providerAttemptContext.js";

const messages = [{ role: "user", content: "hi" }];

let sends;
let restoreFetch;
let fetch;
let unique = 0;

beforeEach(() => {
  sends = [];
  fetch = vi.fn(async (url) => { throw new Error(`unexpected fetch ${url}`); });
  restoreFetch = __setOriginalFetchForTesting(fetch);
  clearZedCaches();
});

afterEach(() => {
  vi.useRealTimers();
  restoreFetch();
});

/** Answer HTTP requests by URL, recording each one as a physical send. */
function serve(route) {
  fetch.mockImplementation(async (url, options) => {
    sends.push({ url: String(url), options });
    return route(String(url), options);
  });
}

/** A 3xx the way fetch reports it: rejected under redirect "error", returned otherwise. */
function redirected(options) {
  if (options.redirect === "error") throw new TypeError("fetch failed", { cause: new Error("unexpected redirect") });
  return new Response(null, { status: 302, headers: { location: "https://redirect.invalid/" } });
}

const sse = (...events) => new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
  headers: { "content-type": "text/event-stream" }
});

const jwt = () => `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.synthetic`;

const completion = () => Response.json({ choices: [{ index: 0, message: { role: "assistant", content: "hi" } }] });

const qoderAnswer = () => new Response(
  `data: ${JSON.stringify({ statusCodeValue: 200, body: JSON.stringify({ choices: [{ index: 0, delta: { content: "hi" }, finish_reason: "stop" }] }) })}\n\ndata: [DONE]\n\n`,
  { headers: { "content-type": "text/event-stream" } });
const qoderInput = () => ({
  model: "auto",
  credentials: { accessToken: "dt-synthetic", providerSpecificData: { userId: "u" } },
  // Qoder forces strictProxy, so its sends need a proxy route.
  proxyOptions: { enabled: true, url: "http://proxy.test:3128" }
});

function grpcFrame(flag, payload) {
  const header = Buffer.alloc(5);
  header[0] = flag;
  header.writeUInt32BE(payload.length, 1);
  return Buffer.concat([header, payload]);
}

/** Protobuf length-delimited field. */
const field = (number, value) => Buffer.concat([Buffer.from([(number << 3) | 2, value.length]), value]);

const ZED_MODEL = "grok-synthetic-1";
const zedInput = () => ({
  model: ZED_MODEL,
  credentials: {
    accessToken: "synthetic-access",
    providerSpecificData: { userId: "u", organizationId: "org", enableSessionDispatch: true }
  }
});
const zedAnswer = () => new Response([
  JSON.stringify({ event: { choices: [{ index: 0, delta: { content: "hi" }, finish_reason: "stop" }] } }),
  JSON.stringify({ status: "stream_ended" })
].join("\n"));
function zedRoute(completions) {
  return (url, options) => {
    if (url.endsWith("/client/llm_tokens")) return Response.json({ token: "llm" });
    if (url.endsWith("/models")) return Response.json({ models: [{ id: ZED_MODEL, provider: "x_ai" }] });
    return completions(url, options);
  };
}

// `attempts` counts physical dispatches, including uncharged setup requests.
// `unchargedFirst` of them still happen when the quota-bearing send is denied.
const cases = [
  {
    name: "qoder",
    attempts: 1,
    unchargedFirst: 0,
    setup() {
      serve(() => qoderAnswer());
      return new QoderExecutor();
    },
    input: qoderInput
  },
  {
    name: "t3-chat-web",
    attempts: 1,
    unchargedFirst: 0,
    setup() {
      serve(() => Response.json({ text: "hi" }));
      return new T3ChatWebExecutor();
    },
    input: () => ({ model: "gpt-5", credentials: { apiKey: "convex-session-id=s" } })
  },
  {
    name: "tencent-aistudio-web",
    attempts: 1,
    unchargedFirst: 0,
    setup() {
      serve(() => completion());
      return new TencentAIStudioWebExecutor();
    },
    input: () => ({ model: "hy3-g", credentials: { apiKey: "session=s" } })
  },
  {
    name: "tinycms-web",
    // Public IP and challenge, then the chat send.
    attempts: 3,
    unchargedFirst: 2,
    setup() {
      serve((url) => {
        if (url.includes("ipify")) return Response.json({ ip: "192.0.2.1" });
        if (url.endsWith("/api/challenge")) return Response.json({ challengeId: "c", challenge: "c", difficulty: 0 });
        return completion();
      });
      return new TinyCmsExecutor();
    },
    // The IP cache is keyed by route, so each run gets its own.
    input: () => ({ model: "gpt", credentials: { apiKey: "R-synthetic" }, proxyOptions: { run: ++unique } })
  },
  {
    name: "twinmind",
    attempts: 2,
    unchargedFirst: 1,
    setup() {
      serve((url) => url.startsWith("https://securetoken.googleapis.com/")
        ? Response.json({ id_token: jwt(), refresh_token: "refresh" })
        : sse({ type: "text_delta", content: "hi" }));
      return new TwinmindExecutor();
    },
    input: () => ({ model: "auto", credentials: { apiKey: "refresh" } })
  },
  {
    name: "veoaifree-web",
    attempts: 2,
    unchargedFirst: 1,
    setup() {
      serve((url) => url.endsWith("admin-ajax.php") ? new Response("https://img.invalid/hi.png") : new Response('nonce":"abc123"'));
      return new VeoAIFreeWebExecutor();
    },
    input: () => ({ model: "veo-image", credentials: {} })
  },
  {
    name: "vertex-partner",
    // Project discovery for a raw key, then the chat send.
    attempts: 2,
    unchargedFirst: 1,
    setup() {
      serve((url) => url.includes("__probe__")
        ? Response.json({ error: { message: "projects/synthetic-project/locations not found" } }, { status: 404 })
        : completion());
      return new VertexExecutor("vertex-partner");
    },
    input: () => ({ model: "meta/llama", credentials: { apiKey: `synthetic-key-${++unique}` } })
  },
  {
    name: "windsurf",
    attempts: 1,
    unchargedFirst: 0,
    setup() {
      serve(() => new Response(Buffer.concat([
        grpcFrame(0x00, field(1, field(1, Buffer.from("hi")))),
        grpcFrame(0x80, Buffer.from("grpc-status: 0\r\n"))
      ])));
      return new WindsurfExecutor();
    },
    input: () => ({ model: "swe-1", credentials: { accessToken: "t" } })
  },
  {
    name: "yuanbao-web",
    attempts: 2,
    unchargedFirst: 1,
    setup() {
      serve((url) => url.endsWith("/conversation/create")
        ? Response.json({ id: "c1" })
        : new Response('data: {"type":"text","msg":"hi"}\n\n'));
      return new YuanbaoWebExecutor();
    },
    input: () => ({ model: "deepseek-v3", credentials: { apiKey: "hy_user=u; hy_token=t" } })
  },
  {
    name: "zed-hosted",
    // LLM token and model catalog, then the completion.
    attempts: 3,
    unchargedFirst: 2,
    setup() {
      serve(zedRoute(() => zedAnswer()));
      return new ZedHostedExecutor();
    },
    input: zedInput
  },
  {
    name: "zenmux-free",
    attempts: 1,
    unchargedFirst: 0,
    setup() {
      serve(() => sse({ type: "content_block_delta", delta: { type: "text_delta", text: "hi" } }, { type: "message_stop" }));
      return new ZenmuxFreeExecutor();
    },
    input: () => ({ model: "deepseek/deepseek-chat", credentials: { apiKey: "ctoken=t" } })
  }
];

const request = (input, extra) => {
  const built = input();
  return { stream: false, body: { model: built.model, messages }, ...built, ...extra };
};

const trackedTicket = () => ({ tracked: true, settle: vi.fn().mockResolvedValue({ changed: true }), release: vi.fn() });

const clock = () => {
  let now = 100;
  return vi.fn(() => ++now);
};

describe.each(cases)("$name on the shared sender (#2308)", ({ attempts, unchargedFirst, setup, input }) => {
  it("charges quota once per send and hands the ticket to the returned response", async () => {
    const executor = setup();
    const ticket = trackedTicket();
    const beginQuotaDispatch = vi.fn().mockResolvedValue(ticket);
    const onProviderAttempt = clock();

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

/** Two tickets, asserting the first is settled as discarded before the second is reserved. */
function resendTickets() {
  const [first, second] = [trackedTicket(), trackedTicket()];
  const beginQuotaDispatch = vi.fn().mockResolvedValueOnce(first).mockImplementationOnce(async () => {
    expect(first.settle).toHaveBeenCalledWith({ success: false, reason: "fallback" });
    return second;
  });
  return { second, beginQuotaDispatch };
}

describe("resends settle the discarded attempt first (#2308)", () => {
  async function expectResend(executor, input) {
    const { second, beginQuotaDispatch } = resendTickets();
    const result = await runWithProviderAttemptContext(() => 1,
      () => executor.execute(request(input)), { beginQuotaDispatch });

    expect(result.response.status).toBe(200);
    expect(beginQuotaDispatch).toHaveBeenCalledTimes(2);
    await settleProviderAttemptDispatch(result.response, { success: true });
    expect(second.settle).toHaveBeenCalledWith({ success: true, reason: "success" });
  }

  it("twinmind re-sends with a refreshed token after a 401", async () => {
    let chats = 0;
    serve((url) => {
      if (url.startsWith("https://securetoken.googleapis.com/")) return Response.json({ id_token: jwt(), refresh_token: "refresh" });
      return ++chats === 1 ? new Response("denied", { status: 401 }) : sse({ type: "text_delta", content: "hi" });
    });
    await expectResend(new TwinmindExecutor(), () => ({ model: "auto", credentials: { apiKey: "refresh" } }));
  });

  it("zed-hosted re-sends with a fresh LLM token after an expired one", async () => {
    let completions = 0;
    serve(zedRoute(() => ++completions === 1
      ? new Response("expired", { status: 401, headers: { "x-zed-expired-token": "true" } })
      : zedAnswer()));
    await expectResend(new ZedHostedExecutor(), zedInput);
  });

  it("qoder replays a queued model", async () => {
    let chats = 0;
    serve((url) => {
      // The queue status says the model is free again, so the replay does not wait.
      if (!url.includes("agent_chat_generation")) return Response.json({ isQueued: false });
      return ++chats === 1
        ? sse({ statusCodeValue: 429, body: JSON.stringify({ code: "10605", message: JSON.stringify({ retryAfterSeconds: 0 }) }) })
        : qoderAnswer();
    });
    await expectResend(new QoderExecutor(), qoderInput);
  });
});

describe("uncharged polling and refused redirects (#2308)", () => {
  it("veoaifree-web charges the video job once and not its result polls", async () => {
    vi.useFakeTimers();
    let ajax = 0;
    serve((url) => {
      if (!url.endsWith("admin-ajax.php")) return new Response('nonce":"abc123"');
      ajax += 1;
      return new Response(ajax === 1 ? "scene" : ajax === 2 ? "" : "https://video.invalid/hi.mp4");
    });
    const beginQuotaDispatch = vi.fn().mockResolvedValue(trackedTicket());

    const pending = runWithProviderAttemptContext(() => 1, () => new VeoAIFreeWebExecutor()
      .execute(request(() => ({ model: "veo-3.1", credentials: {} }))), { beginQuotaDispatch });
    await vi.advanceTimersByTimeAsync(40_000);

    expect((await pending).response.status).toBe(200);
    expect(sends).toHaveLength(4);
    expect(beginQuotaDispatch).toHaveBeenCalledOnce();
  });

  it.each([
    ["tencent-aistudio-web", TencentAIStudioWebExecutor, "session=s", "/api/chat/"],
    ["tinycms-web", TinyCmsExecutor, "R-synthetic", "/chat/completions"]
  ])("%s still reports a redirected chat send as an expired session", async (_name, Executor, apiKey, chatPath) => {
    serve((url, options) => {
      if (url.includes(chatPath)) return redirected(options);
      if (url.includes("ipify")) return Response.json({ ip: "192.0.2.1" });
      return Response.json({ challengeId: "c", challenge: "c", difficulty: 0 });
    });
    const beginQuotaDispatch = vi.fn().mockResolvedValue(trackedTicket());

    const result = await runWithProviderAttemptContext(() => 1, () => new Executor()
      .execute(request(() => ({ model: "m", credentials: { apiKey }, proxyOptions: { run: ++unique } }))), { beginQuotaDispatch });

    expect(sends.at(-1).options.redirect).toBe("error");
    expect(result.response.status).toBe(401);
  });
});
