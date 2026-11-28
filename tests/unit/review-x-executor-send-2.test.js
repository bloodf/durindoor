import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { crc32 } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __setOriginalFetchForTesting } from "../../open-sse/utils/proxyFetch.js";
import { AuggieExecutor } from "../../open-sse/executors/auggie.js";
import { BedrockExecutor } from "../../open-sse/executors/bedrock.js";
import { AmeliaClient, ChipotleExecutor } from "../../open-sse/executors/chipotle.js";
import { DifyExecutor } from "../../open-sse/executors/dify.js";
import { NlpCloudExecutor } from "../../open-sse/executors/nlpcloud.js";
import { ReplicateExecutor } from "../../open-sse/executors/replicate.js";
import { ZaiWebExecutor } from "../../open-sse/executors/zai-web.js";
import { ZcodeExecutor } from "../../open-sse/executors/zcode.js";
import { createRequestSender } from "../../open-sse/executors/sendRequest.js";
import { QuotaDispatchUnavailableError } from "../../open-sse/services/quota/dispatch.js";
import {
  runWithProviderAttemptContext,
  settleProviderAttemptDispatch
} from "../../open-sse/services/providerAttemptContext.js";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, spawn: vi.fn() };
});

const messages = [{ role: "user", content: "hi" }];
const apiKey = { apiKey: "test-key" };
let fetch;
let restoreFetch;
let sends;

beforeEach(() => {
  // A closed loopback port: the AWS SDK can never leave this machine.
  vi.stubEnv("AWS_ENDPOINT_URL_BEDROCK_RUNTIME", "http://127.0.0.1:9");
  sends = [];
  fetch = vi.fn(async () => { throw new Error("unexpected fetch"); });
  restoreFetch = __setOriginalFetchForTesting(fetch);
  vi.mocked(spawn).mockReset();
});

afterEach(() => {
  restoreFetch();
  vi.unstubAllEnvs();
});

function reply(...responses) {
  for (const make of responses) {
    fetch.mockImplementationOnce(async (url, options) => {
      sends.push({ url: String(url), options });
      return make();
    });
  }
}

function fakeAuggie() {
  vi.mocked(spawn).mockImplementation(() => {
    sends.push({ url: "auggie" });
    const child = new EventEmitter();
    child.stdin = Object.assign(new EventEmitter(), { write: vi.fn(), end: vi.fn() });
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn();
    queueMicrotask(() => queueMicrotask(() => {
      child.stdout.emit("data", Buffer.from("hi"));
      child.emit("close", 0);
    }));
    return child;
  });
}

function zcodeExecutor({ silentOn = null } = {}) {
  const commands = [];
  const executor = new ZcodeExecutor({
    cwd: "/synthetic/workspace",
    spawnProcess: () => {
      const proc = new EventEmitter();
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.kill = vi.fn();
      const emit = (value) => proc.stdout.emit("data", `${JSON.stringify(value)}\n`);
      proc.stdin = {
        end: vi.fn(),
        write: (line) => {
          const { id, params } = JSON.parse(line);
          if (params?.type) commands.push(params.type);
          if (params?.type && params.type === silentOn) return;
          if (params?.type === "sendText") sends.push({ url: "zcode" });
          queueMicrotask(() => {
            emit({ jsonrpc: "2.0", id, result: { status: "accepted" } });
            if (params?.type !== "sendText") return;
            emit({ jsonrpc: "2.0", method: "v4/conversation/frame", params: { frame: { toSeq: 1, payload: {
              kind: "snapshot",
              snapshot: { rows: [{ rowId: 1, kind: "assistantText", text: "hi" }], control: { phase: "completedSuccess" } }
            } } } });
          });
        }
      };
      return proc;
    }
  });
  return { executor, commands };
}

function fakeAmeliaSocket() {
  const socket = new EventEmitter();
  socket.readyState = 1;
  socket.close = vi.fn();
  const deliver = (frame) => queueMicrotask(() => socket.emit("message", Buffer.from(`a${JSON.stringify([frame])}`)));
  socket.send = (raw) => {
    const [frame] = JSON.parse(raw);
    if (frame.startsWith("CONNECT")) deliver("CONNECTED\n\n\0");
    if (frame.startsWith("SEND")) {
      sends.push({ url: "amelia-socket" });
      deliver('MESSAGE\n\n{"text":"hi"}\0');
    }
  };
  queueMicrotask(() => socket.emit("message", Buffer.from("o")));
  return socket;
}

const zaiToken = `h.${Buffer.from(JSON.stringify({ id: "user" })).toString("base64url")}.s`;

// `attempts` counts physical dispatches, including uncharged setup requests.
const cases = [
  {
    name: "chipotle",
    attempts: 2,
    setup() {
      reply(() => Response.json({ csrfToken: "csrf", user: { userId: "u" } }));
      return new ChipotleExecutor(async () => new AmeliaClient({ webSocketFactory: fakeAmeliaSocket }));
    },
    input: { model: "pepper" }
  },
  {
    name: "bedrock",
    attempts: 1,
    setup() {
      reply(() => Response.json({
        output: { message: { role: "assistant", content: [{ text: "hi" }] } },
        stopReason: "end_turn",
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }
      }));
      return new BedrockExecutor();
    },
    input: { model: "anthropic.claude-sonnet-4-6", credentials: apiKey }
  },
  {
    name: "auggie",
    attempts: 1,
    setup() {
      fakeAuggie();
      return new AuggieExecutor();
    },
    input: { model: "claude-sonnet-4.6" }
  },
  {
    name: "zcode",
    attempts: 1,
    setup: () => zcodeExecutor().executor,
    input: { model: "glm", credentials: { providerSpecificData: { enableSessionDispatch: true } } }
  },
  {
    name: "dify",
    attempts: 1,
    setup() {
      reply(() => Response.json({ answer: "hi" }));
      return new DifyExecutor();
    },
    input: { model: "configured-app", credentials: apiKey }
  },
  {
    name: "nlpcloud",
    attempts: 1,
    setup() {
      reply(() => Response.json({ response: "hi" }));
      return new NlpCloudExecutor();
    },
    input: { model: "chatdolphin", credentials: apiKey }
  },
  {
    name: "replicate",
    attempts: 1,
    setup() {
      reply(() => Response.json({ status: "succeeded", output: "hi" }));
      return new ReplicateExecutor();
    },
    input: { model: "owner/model", credentials: apiKey }
  },
  {
    name: "zai-web",
    attempts: 2,
    setup() {
      reply(
        () => Response.json({ id: "chat-1" }),
        // A complete source-shaped event stream: the executor refuses non-SSE or unterminated replies.
        () => new Response('data: {"data":{"delta_content":"hi","phase":"answer"}}\n\ndata: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } })
      );
      return new ZaiWebExecutor();
    },
    // Synthetic opaque CAPTCHA proof (a stored source location) so the executor dispatches at all.
    input: { model: "glm-5.3", credentials: { apiKey: zaiToken, providerSpecificData: { captchaVerifyParam: "synthetic-proof-send" } } }
  }
];

function request(input) {
  return { stream: false, body: { messages }, ...input };
}

describe.each(cases)("$name on the shared sender (#2308)", ({ attempts, setup, input }) => {
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
    // HTTP sends fail closed on redirects, whether rejected or handled manually.
    for (const { options } of sends.filter((send) => send.options)) {
      expect(["error", "manual"]).toContain(options.redirect);
      expect(options.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("sends nothing when the signal is already aborted", async () => {
    const executor = setup();
    const beginQuotaDispatch = vi.fn();

    await expect(runWithProviderAttemptContext(() => 1,
      () => executor.execute(request({ ...input, signal: AbortSignal.abort() })), { beginQuotaDispatch }))
      .rejects.toMatchObject({ name: "AbortError" });

    expect(sends).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
    expect(beginQuotaDispatch).not.toHaveBeenCalled();
  });

  it("surfaces a local quota denial without making the billable send", async () => {
    const executor = setup();
    const beginQuotaDispatch = vi.fn().mockRejectedValue(new QuotaDispatchUnavailableError());

    await expect(runWithProviderAttemptContext(() => 1,
      () => executor.execute(request(input)), { beginQuotaDispatch }))
      .rejects.toMatchObject({ code: "QUOTA_DISPATCH_UNAVAILABLE" });

    // Only the uncharged setup request, if the provider has one, was sent.
    expect(sends).toHaveLength(attempts - 1);
  });
});

/** Encode one AWS event-stream message: prelude, string headers, payload, CRCs. */
function awsEvent(type, payload) {
  const headers = Buffer.concat(Object.entries({
    ":message-type": "event",
    ":event-type": type,
    ":content-type": "application/json"
  }).map(([name, value]) => Buffer.concat([
    Buffer.from([name.length]), Buffer.from(name), Buffer.from([7, 0, value.length]), Buffer.from(value)
  ])));
  const body = Buffer.from(JSON.stringify(payload));
  const uint32 = (value) => {
    const bytes = Buffer.alloc(4);
    bytes.writeUInt32BE(value >>> 0);
    return bytes;
  };
  const prelude = Buffer.concat([uint32(16 + headers.length + body.length), uint32(headers.length)]);
  const message = Buffer.concat([prelude, uint32(crc32(prelude)), headers, body]);
  return Buffer.concat([message, uint32(crc32(message))]);
}

describe("Bedrock's SDK transport on the shared sender (#2308)", () => {
  const input = {
    model: "anthropic.claude-sonnet-4-6",
    credentials: { apiKey: "test-key", providerSpecificData: { accessKeyId: "AKIDTEST" } }
  };

  it("decodes ConverseStream and sends a SigV4 request fetch can carry", async () => {
    reply(() => new Response(Buffer.concat([
      awsEvent("contentBlockDelta", { contentBlockIndex: 0, delta: { text: "streamed" } }),
      awsEvent("messageStop", { stopReason: "end_turn" })
    ]), { headers: { "content-type": "application/vnd.amazon.eventstream" } }));

    const { response } = await new BedrockExecutor().execute(request({ ...input, stream: true }));
    const text = await response.text();

    expect(text).toContain('"content":"streamed"');
    expect(text).toContain('"finish_reason":"stop"');
    expect(sends[0].url).toMatch(/\/converse-stream$/);
    const names = Object.keys(sends[0].options.headers).map((name) => name.toLowerCase());
    expect(names).toContain("authorization");
    expect(names).not.toContain("host");
    expect(names).not.toContain("content-length");
    expect(sends[0].options.redirect).toBe("error");
  });

  it("keeps the upstream status and quota ticket on a rejected request", async () => {
    reply(() => Response.json({ message: "slow down" }, {
      status: 429, headers: { "x-amzn-errortype": "ThrottlingException" }
    }));
    const ticket = { tracked: true, settle: vi.fn().mockResolvedValue({ changed: true }), release: vi.fn() };

    const { response } = await runWithProviderAttemptContext(() => 1,
      () => new BedrockExecutor().execute(request(input)), { beginQuotaDispatch: async () => ticket });

    expect(response.status).toBe(429);
    expect((await response.json()).error).toMatchObject({ message: "slow down", code: "ThrottlingException" });
    expect(sends).toHaveLength(1);
    await settleProviderAttemptDispatch(response, { success: false });
    expect(ticket.settle).toHaveBeenCalledOnce();
  });
});

describe("transport sends (#2308)", () => {
  it("stops waiting at the header deadline even when the transport ignores the signal", async () => {
    const sender = createRequestSender({ headerTimeoutMs: 5 });

    await expect(sender.sendRequest("local://transport", {}, null, { transport: () => new Promise(() => {}) }))
      .rejects.toThrow(/timeout/i);
  });

  it("aborts a ZCode turn waiting for the sendText acknowledgement and releases the ticket", async () => {
    const { executor, commands } = zcodeExecutor({ silentOn: "sendText" });
    const controller = new AbortController();
    const ticket = { tracked: true, settle: vi.fn(), release: vi.fn() };
    const pending = runWithProviderAttemptContext(() => 1, () => executor.execute(request({
      model: "glm",
      signal: controller.signal,
      credentials: { providerSpecificData: { enableSessionDispatch: true } }
    })), { beginQuotaDispatch: async () => ticket });
    await vi.waitFor(() => expect(commands).toContain("sendText"));
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(ticket.release).toHaveBeenCalledWith("abort");
    expect(commands).toContain("deleteSession");
    expect(executor.active).toBe(0);
  });
});
