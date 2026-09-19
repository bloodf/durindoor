import { describe, expect, it } from "vitest";

import { OpenCodeExecutor, OPENCODE_REQUEST_RE, OPENCODE_SESSION_RE } from "../../open-sse/executors/opencode.js";

// Upstream 0c6ab4f9: reuse one stable session per identity (already covered by
// opencode-official-headers.test.js "uses trusted connection identity" via the
// deterministic canonicalSessionId/trustedSessionKey chain from PR #907 — no
// new session cache was introduced here, see the class doc in opencode.js)
// plus a deterministic x-opencode-request per logical turn, ported below.
describe("OpenCodeExecutor stable request id (#0c6ab4f9)", () => {
  it("derives the same request id for retries of the same turn under one identity", () => {
    const executor = new OpenCodeExecutor();
    const credentials = { connectionId: "conn-a" };
    const body = () => ({ messages: [{ role: "user", content: "run the deploy script" }] });

    const first = executor.prepareRequestCredentials({ body: body(), credentials });
    const retry = executor.prepareRequestCredentials({ body: body(), credentials });

    expect(first._opencodeSession).toBe(retry._opencodeSession);
    expect(first._opencodeRequest).toBe(retry._opencodeRequest);
    expect(first._opencodeRequest).toMatch(OPENCODE_REQUEST_RE);
  });

  it("derives a different request id for a new turn under the same identity", () => {
    const executor = new OpenCodeExecutor();
    const credentials = { connectionId: "conn-a" };

    const turnOne = executor.prepareRequestCredentials({
      body: { messages: [{ role: "user", content: "first turn" }] },
      credentials,
    });
    const turnTwo = executor.prepareRequestCredentials({
      body: { messages: [{ role: "user", content: "second turn" }] },
      credentials,
    });

    expect(turnOne._opencodeSession).toBe(turnTwo._opencodeSession);
    expect(turnOne._opencodeRequest).not.toBe(turnTwo._opencodeRequest);
  });

  it("derives a different request id for the same turn text under a different identity", () => {
    const executor = new OpenCodeExecutor();
    const body = { messages: [{ role: "user", content: "same text" }] };

    const a = executor.prepareRequestCredentials({ body, credentials: { connectionId: "conn-a" } });
    const b = executor.prepareRequestCredentials({ body, credentials: { connectionId: "conn-b" } });

    expect(a._opencodeSession).not.toBe(b._opencodeSession);
    expect(a._opencodeRequest).not.toBe(b._opencodeRequest);
  });

  it("preserves an already-canonical native x-opencode-request header instead of deriving one", () => {
    const executor = new OpenCodeExecutor();
    const valid = "msg_0123456789abABCDEFGHIJKLMN";
    const prepared = executor.prepareRequestCredentials({
      body: { messages: [{ role: "user", content: "hi" }] },
      credentials: { connectionId: "conn-a", rawHeaders: { "x-opencode-request": valid } },
    });
    expect(prepared._opencodeRequest).toBe(valid);
  });

  it("ignores a non-canonical native x-opencode-request header and derives instead", () => {
    const executor = new OpenCodeExecutor();
    const prepared = executor.prepareRequestCredentials({
      body: { messages: [{ role: "user", content: "hi" }] },
      credentials: { connectionId: "conn-a", rawHeaders: { "x-opencode-request": "msg_not_canonical" } },
    });
    expect(prepared._opencodeRequest).not.toBe("msg_not_canonical");
    expect(prepared._opencodeRequest).toMatch(OPENCODE_REQUEST_RE);
  });

  it("falls back to a fresh id when the turn has no readable user text", () => {
    const executor = new OpenCodeExecutor();
    const credentials = { connectionId: "conn-a" };
    const first = executor.prepareRequestCredentials({ body: { messages: [] }, credentials });
    const second = executor.prepareRequestCredentials({ body: { messages: [] }, credentials });
    expect(first._opencodeSession).toBe(second._opencodeSession);
    expect(first._opencodeRequest).not.toBe(second._opencodeRequest);
  });

  // Concurrency: prepareRequestCredentials is a pure, synchronous function of
  // its arguments (a deterministic hash, not a shared cache read/write), so
  // interleaved concurrent calls for different identities can never race or
  // leak into each other's session/request id, and calls for the SAME identity
  // simply compute the same value independently — no lock, no shared mutable
  // state, no singleton field is written (contrast with the this._currentSessionId
  // bug fixed in PR #907).
  it("computes session and request id independently per call with no shared mutable state", () => {
    const executor = new OpenCodeExecutor();
    const results = ["conn-a", "conn-b", "conn-a", "conn-c", "conn-b"].map((connectionId) =>
      executor.prepareRequestCredentials({
        body: { messages: [{ role: "user", content: "concurrent turn" }] },
        credentials: { connectionId },
      })
    );
    expect(results[0]._opencodeSession).toBe(results[2]._opencodeSession);
    expect(results[1]._opencodeSession).toBe(results[4]._opencodeSession);
    expect(results[0]._opencodeSession).not.toBe(results[1]._opencodeSession);
    expect(results[0]._opencodeSession).not.toBe(results[3]._opencodeSession);
    // No property on the executor instance holds request-scoped state.
    expect(executor._currentSessionId).toBeUndefined();
    expect(executor._currentRequestId).toBeUndefined();
  });

  it("buildHeaders threads the prepared request id onto the outgoing header", async () => {
    const executor = new OpenCodeExecutor();
    const prepared = executor.prepareRequestCredentials({
      body: { messages: [{ role: "user", content: "hi" }] },
      credentials: { connectionId: "conn-a" },
    });
    const headers = executor.buildHeaders(prepared, true);
    expect(headers["x-opencode-request"]).toBe(prepared._opencodeRequest);
    expect(headers["x-opencode-session"]).toBe(prepared._opencodeSession);
    expect(headers["x-opencode-session"]).toMatch(OPENCODE_SESSION_RE);
  });
});
