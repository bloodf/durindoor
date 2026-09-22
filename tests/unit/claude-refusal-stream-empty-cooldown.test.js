// Round 3 review finding on PR #934 (upstream #4210, Claude refusal stop_reason
// mapping): a streamed Claude refusal never accumulates delta text (translate
// mode only appends parsed.delta.text) and reports output_tokens: 0, so it
// looked identical to a truncated/dead stream to the empty-stream cooldown
// guard in buildOnStreamComplete, benching the account for
// EMPTY_CONTENT_COOLDOWN_MS even though the turn finished cleanly.
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildOnStreamComplete } from "../../open-sse/handlers/chatCore/streamingHandler.js";

vi.mock("@/lib/usageDb.js", () => ({
  saveRequestDetail: vi.fn(() => Promise.resolve()),
  saveRequestUsage: vi.fn(() => Promise.resolve()),
  appendRequestLog: vi.fn(() => Promise.resolve()),
}));

afterEach(() => vi.restoreAllMocks());

function build(onEmptyStream) {
  return buildOnStreamComplete({
    provider: "claude",
    model: "claude-opus-5",
    connectionId: "connection",
    requestStartTime: 1000,
    body: { messages: [{ role: "user", content: "hi" }] },
    stream: true,
    onEmptyStream,
    log: { line: vi.fn(), warn: vi.fn() },
  });
}

describe("buildOnStreamComplete: streamed Claude refusal skips the empty-stream cooldown", () => {
  it("does not cool down when the stream terminates in a native Claude refusal", () => {
    const onEmptyStream = vi.fn();
    const { onStreamComplete } = build(onEmptyStream);

    onStreamComplete(
      { content: "" },
      { prompt_tokens: 12, completion_tokens: 0 },
      1005,
      { providerResponse: { type: "message", stop_reason: "refusal", content: [] } },
    );

    expect(onEmptyStream).not.toHaveBeenCalled();
  });

  it("still cools down a genuinely empty, non-refusal stream", () => {
    const onEmptyStream = vi.fn();
    const { onStreamComplete } = build(onEmptyStream);

    onStreamComplete(
      { content: "" },
      { prompt_tokens: 12, completion_tokens: 0 },
      1005,
      { providerResponse: { type: "message", stop_reason: "end_turn", content: [] } },
    );

    expect(onEmptyStream).toHaveBeenCalledTimes(1);
  });
});
