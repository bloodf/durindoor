import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Outbound/inbound wire proof for OmniRoute #6820 (issue #3697) port:
 * Codex CLI compatibility shim. The upstream request keeps the bare upstream
 * model id (`gpt-5.5`), while Responses SSE payloads echo the client-requested
 * effort-suffixed id (`gpt-5.5-xhigh`) so the Codex CLI status line/model
 * button shows the active reasoning effort.
 *
 * DurinDoor deviation from the upstream PR: the echo lives in the Codex
 * executor (response-side rewrite after the SSE transient-error peek), driven
 * by `requestContext.requestedModel` — not a global chatCore echo pipeline.
 */

const CODEX_URL = "https://chatgpt.com/backend-api/codex/responses";

function sseText(frames, eol = "\n") {
  return frames.join(`${eol}${eol}`) + `${eol}${eol}`;
}

function sseResponse({ model = "gpt-5.5", eol = "\n", headers = {} } = {}) {
  const frames = [
    `event: response.created${eol}data: {"type":"response.created","response":{"id":"resp_1","object":"response","model":"${model}","status":"in_progress"}}`,
    `event: response.in_progress${eol}data: {"type":"response.in_progress","response":{"id":"resp_1","object":"response","model":"${model}","status":"in_progress"}}`,
    `event: response.output_text.delta${eol}data: {"type":"response.output_text.delta","delta":"ok"}`,
    `event: response.completed${eol}data: {"type":"response.completed","response":{"id":"resp_1","object":"response","model":"${model}","status":"completed"}}`,
  ];
  return new Response(sseText(frames, eol), {
    status: 200,
    headers: { "Content-Type": "text/event-stream", ...headers },
  });
}

const proxyAwareFetch = vi.fn(async () => sseResponse());

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch,
}));

// Hoisted out of the timed test section: a cold dynamic import under parallel
// worker load can exceed the per-test timeout and leave stale fetch-mock calls
// that poison subsequent assertions.
const { CodexExecutor } = await import("../../open-sse/executors/codex.js");

async function executeWithModel({ model, requestedModel, extraBody = {} }) {
  const executor = new CodexExecutor();
  return executor.execute({
    model,
    body: { model, input: "hi", ...extraBody },
    stream: true,
    credentials: {
      accessToken: "test-token",
      connectionId: "conn_test",
      providerSpecificData: { chatgptAccountId: "acct_test" },
    },
    log: null,
    requestContext: requestedModel ? { requestedModel } : {},
  });
}

function parsePostedBody() {
  expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
  const [url, options] = proxyAwareFetch.mock.calls[0];
  expect(url).toBe(CODEX_URL);
  expect(options.method).toBe("POST");
  return JSON.parse(options.body);
}

async function readBodyText(response) {
  return new Response(response.body).text();
}

function framePayloads(text, eventName) {
  return text
    .split(/\r?\n\r?\n/)
    .filter((frame) => frame.includes(`event: ${eventName}`))
    .map((frame) => {
      const dataLine = frame.split(/\r?\n/).find((line) => line.startsWith("data:"));
      return JSON.parse(dataLine.slice(5).trim());
    });
}

describe("Codex effort-suffixed model echo (OmniRoute #6820 / issue #3697)", () => {
  beforeEach(() => {
    proxyAwareFetch.mockClear();
    proxyAwareFetch.mockImplementation(async () => sseResponse());
  });

  it("posts the bare upstream model id while Responses payloads echo the requested effort-suffixed id", async () => {
    const result = await executeWithModel({
      model: "gpt-5.5",
      requestedModel: "gpt-5.5-xhigh",
    });

    // Routing unchanged: upstream wire id stays bare, effort lands on reasoning.
    const posted = parsePostedBody();
    expect(posted.model).toBe("gpt-5.5");
    expect(posted.reasoning.effort).toBeDefined();

    // Response side: created/in_progress/completed echo the client-requested id.
    const text = await readBodyText(result.response);
    for (const event of ["response.created", "response.in_progress", "response.completed"]) {
      const payloads = framePayloads(text, event);
      expect(payloads).toHaveLength(1);
      expect(payloads[0].response.model).toBe("gpt-5.5-xhigh");
    }
    // No bare upstream id left anywhere in echoed payloads.
    expect(text).not.toContain('"model":"gpt-5.5"');
  });

  it("does not echo when the requested id has no recognized effort suffix", async () => {
    const result = await executeWithModel({
      model: "gpt-5.5",
      requestedModel: "gpt-5.5",
    });

    const text = await readBodyText(result.response);
    const payloads = framePayloads(text, "response.completed");
    expect(payloads[0].response.model).toBe("gpt-5.5");
  });

  it("does not echo non-effort aliases (no suffix leak into response.model)", async () => {
    const result = await executeWithModel({
      model: "gpt-5.5",
      requestedModel: "my-codex-alias",
    });

    const text = await readBodyText(result.response);
    const payloads = framePayloads(text, "response.completed");
    expect(payloads[0].response.model).toBe("gpt-5.5");
    expect(text).not.toContain("my-codex-alias");
  });

  it("leaves the stream untouched when requestContext carries no requestedModel", async () => {
    const result = await executeWithModel({ model: "gpt-5.5", requestedModel: null });

    const text = await readBodyText(result.response);
    const payloads = framePayloads(text, "response.completed");
    expect(payloads[0].response.model).toBe("gpt-5.5");
  });

  it("drops upstream content-length on the transformed response", async () => {
    proxyAwareFetch.mockImplementation(async () =>
      sseResponse({ headers: { "Content-Length": "512" } })
    );
    const result = await executeWithModel({
      model: "gpt-5.5",
      requestedModel: "gpt-5.5-xhigh",
    });

    expect(result.response.headers.get("content-length")).toBeNull();
    // Stream still parses end-to-end.
    const text = await readBodyText(result.response);
    expect(framePayloads(text, "response.completed")).toHaveLength(1);
  });

  it("preserves CRLF framing and only rewrites model-bearing frames", async () => {
    proxyAwareFetch.mockImplementation(async () => sseResponse({ eol: "\r\n" }));
    const result = await executeWithModel({
      model: "gpt-5.5",
      requestedModel: "gpt-5.5-xhigh",
    });

    const text = await readBodyText(result.response);
    // CRLF delimiter style survives the transform.
    expect(text).toContain("\r\n\r\n");
    // Non-model frame (output_text.delta) passes through unchanged.
    expect(text).toContain('data: {"type":"response.output_text.delta","delta":"ok"}');
    const payloads = framePayloads(text, "response.completed");
    expect(payloads[0].response.model).toBe("gpt-5.5-xhigh");
  });

  it("reassembles frames split across chunk boundaries before rewriting", async () => {
    const full = [
      'event: response.created\r\ndata: {"type":"response.created","response":{"id":"resp_1","model":"gpt-5.5","status":"in_progress"}}',
      'event: response.completed\r\ndata: {"type":"response.completed","response":{"id":"resp_1","model":"gpt-5.5","status":"completed"}}',
    ].join("\r\n\r\n") + "\r\n\r\n";
    const encoded = new TextEncoder().encode(full);
    // Split mid-JSON inside the first frame's data payload.
    const splitAt = full.indexOf('"model"') + 3;
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoded.subarray(0, splitAt));
        controller.enqueue(encoded.subarray(splitAt));
        controller.close();
      },
    });
    proxyAwareFetch.mockImplementation(
      async () => new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } })
    );

    const result = await executeWithModel({
      model: "gpt-5.5",
      requestedModel: "gpt-5.5-xhigh",
    });
    const text = await readBodyText(result.response);
    expect(framePayloads(text, "response.created")[0].response.model).toBe("gpt-5.5-xhigh");
    expect(framePayloads(text, "response.completed")[0].response.model).toBe("gpt-5.5-xhigh");
  });

  it("strips only a trailing effort suffix from the routing id (prefix occurrences kept)", async () => {
    // Model id containing an effort word earlier in the name: only the trailing
    // `-high` is stripped for the wire; echo still uses the full client id.
    proxyAwareFetch.mockImplementation(async () =>
      sseResponse({ model: "gpt-high-codex" })
    );
    const result = await executeWithModel({
      model: "gpt-high-codex-high",
      requestedModel: "gpt-high-codex-high",
    });

    const posted = parsePostedBody();
    expect(posted.model).toBe("gpt-high-codex");
    expect(posted.reasoning.effort).toBe("high");
    const text = await readBodyText(result.response);
    expect(framePayloads(text, "response.completed")[0].response.model).toBe("gpt-high-codex-high");
  });
});
