// Kiro direct session continuation affinity (port of decolua/9router #2580).
//
// KiroExecutor.transformRequest stamps one stable agentContinuationId per
// (scope, connectionId, model, conversationId) tuple so the upstream reuses
// its warm session cache across turns of a conversation, while account and
// model key dimensions prevent a continuation from ever leaking across
// accounts or models — even when clients present identical session ids.
//
// Run: node node_modules/vitest/vitest.mjs run unit/kiro-session-affinity.test.js

import { describe, it, expect, beforeEach } from "vitest";
import { KiroExecutor } from "../../open-sse/executors/kiro.js";
import { clearSessionStore, resolveContinuationId, resolveSessionId, captureSessionId } from "../../open-sse/utils/sessionManager.js";
import { openaiToKiroRequest } from "../../open-sse/translator/request/openai-to-kiro.js";

const executor = new KiroExecutor();

function kiroBody(conversationId) {
  return {
    conversationState: {
      chatTriggerType: "MANUAL",
      conversationId,
      currentMessage: { userInputMessage: { content: "hi", modelId: "claude-sonnet-4.5", origin: "AI_EDITOR" } },
      history: [],
    },
  };
}

function requestContext(headers = {}) {
  return Object.freeze({ clientHeaders: headers });
}

beforeEach(() => clearSessionStore());

describe("kiro direct session continuation affinity", () => {
  it("hit: same explicit account + model + session reuses the continuation id", () => {
    const credentials = { connectionId: "conn-a", rawHeaders: { "x-session-id": "sess-1" } };
    const first = executor.transformRequest("claude-sonnet-4.5", kiroBody("sess-1"), true, credentials);
    const second = executor.transformRequest("claude-sonnet-4.5", kiroBody("sess-1"), true, credentials);

    const id = first.conversationState.agentContinuationId;
    expect(typeof id).toBe("string");
    expect(id).toBeTruthy();
    expect(second.conversationState.agentContinuationId).toBe(id);
    expect(first.conversationState.agentTaskType).toBe("vibe");
    expect(first.agentMode).toBe("vibe");
  });

  it("miss: a different session affinity gets a different continuation id", () => {
    const credentials = { connectionId: "conn-a", rawHeaders: { "x-session-id": "sess-1" } };
    const a = executor.transformRequest("claude-sonnet-4.5", kiroBody("sess-1"), true, credentials);
    const b = executor.transformRequest("claude-sonnet-4.5", kiroBody("sess-2"), true, credentials);

    expect(a.conversationState.agentContinuationId).not.toBe(b.conversationState.agentContinuationId);
  });

  it("isolation: same session id on different accounts never shares a continuation", () => {
    const shared = kiroBody("sess-shared");
    const a = executor.transformRequest("claude-sonnet-4.5", kiroBody("sess-shared"), true, { connectionId: "conn-a", rawHeaders: { "x-session-id": "sess-shared" } });
    const b = executor.transformRequest("claude-sonnet-4.5", shared, true, { connectionId: "conn-b", rawHeaders: { "x-session-id": "sess-shared" } });

    expect(a.conversationState.agentContinuationId).not.toBe(b.conversationState.agentContinuationId);
  });

  it("isolation: same session id on different models never shares a continuation", () => {
    const credentials = { connectionId: "conn-a", rawHeaders: { "x-session-id": "sess-1" } };
    const a = executor.transformRequest("claude-sonnet-4.5", kiroBody("sess-1"), true, credentials);
    const b = executor.transformRequest("claude-opus-4.1", kiroBody("sess-1"), true, credentials);

    expect(a.conversationState.agentContinuationId).not.toBe(b.conversationState.agentContinuationId);
  });

  it("wires resolveSessionId affinity end-to-end: same client session hits, different misses", () => {
    // The executor consumes the conversationId the translator derived from
    // resolveSessionId — this breaks if either side of the wiring regresses.
    const credentials = { connectionId: "conn-a", rawHeaders: { "x-session-id": "client-sess-1" } };
    const sessionA = resolveSessionId({ headers: credentials.rawHeaders, body: {}, connectionId: "conn-a", scope: "kiro" });
    const sessionB = resolveSessionId({ headers: { "x-session-id": "client-sess-2" }, body: {}, connectionId: "conn-a", scope: "kiro" });

    const hit = executor.transformRequest("claude-sonnet-4.5", kiroBody(sessionA), true, credentials);
    expect(hit.conversationState.agentContinuationId)
      .toBe(executor.transformRequest("claude-sonnet-4.5", kiroBody(sessionA), true, credentials)
        .conversationState.agentContinuationId);
    expect(executor.transformRequest("claude-sonnet-4.5", kiroBody(sessionB), true, credentials)
      .conversationState.agentContinuationId).not.toBe(hit.conversationState.agentContinuationId);
  });

  it("translator payload flows through transformRequest with continuation stamped", () => {
    const body = { model: "claude-sonnet-4.5", messages: [{ role: "user", content: "hello" }] };
    const credentials = { connectionId: "conn-a", rawHeaders: { "x-session-id": "client-sess-9" } };
    const translated = openaiToKiroRequest("claude-sonnet-4.5", body, true, credentials);
    const out = executor.transformRequest("claude-sonnet-4.5", translated, true, credentials);

    expect(translated.conversationState.conversationId).toBe("client-sess-9");
    expect(out.conversationState.agentContinuationId).toBeTruthy();
    expect(out.conversationState.agentTaskType).toBe("vibe");
    expect(out.agentMode).toBe("vibe");
    // Same conversation on a second account gets its own continuation.
    const other = executor.transformRequest("claude-sonnet-4.5", translated, true, { ...credentials, connectionId: "conn-b" });
    expect(other.conversationState.agentContinuationId).not.toBe(out.conversationState.agentContinuationId);
  });

  it("retry/fallback re-dispatch reuses the same continuation id", () => {
    // BaseExecutor invokes transformRequest per URL attempt; a retry must not
    // mint a fresh continuation or the upstream warm-cache reuse is defeated.
    const ctx = requestContext();
    const credentials = { connectionId: "conn-a" };
    const attempt1 = executor.transformRequest("claude-sonnet-4.5", kiroBody("sess-1"), true, credentials, ctx);
    const attempt2 = executor.transformRequest("claude-sonnet-4.5", kiroBody("sess-1"), true, credentials, ctx);
    expect(attempt2.conversationState.agentContinuationId)
      .toBe(attempt1.conversationState.agentContinuationId);
  });

  it("headerless generated sessions do not leak across independent requests", () => {
    // Two unrelated first-turn headerless conversations on the same account and
    // model must not share a continuation id, even though they both have the
    // same generated sessionId (derived from connectionId).
    const credentials = { connectionId: "conn-a" };
    const a = executor.transformRequest("claude-sonnet-4.5", kiroBody("sess-1"), true, credentials, requestContext());
    const b = executor.transformRequest("claude-sonnet-4.5", kiroBody("sess-1"), true, credentials, requestContext());

    expect(a.conversationState.agentContinuationId).not.toBe(b.conversationState.agentContinuationId);
  });

  it("explicit header session reuses across different request contexts", () => {
    // A client-supplied session id must continue across turns even when each
    // turn arrives with a different inbound requestContext.
    const credentials = { connectionId: "conn-a", rawHeaders: { "x-session-id": "client-sess-7" } };
    const a = executor.transformRequest("claude-sonnet-4.5", kiroBody("client-sess-7"), true, credentials, requestContext());
    const b = executor.transformRequest("claude-sonnet-4.5", kiroBody("client-sess-7"), true, credentials, requestContext());

    expect(a.conversationState.agentContinuationId).toBe(b.conversationState.agentContinuationId);
  });

  it("does not mutate the caller's payload", () => {
    const body = kiroBody("sess-1");
    const out = executor.transformRequest("claude-sonnet-4.5", body, true, { connectionId: "conn-a" }, requestContext());

    expect(out).not.toBe(body);
    expect(body.conversationState.agentContinuationId).toBeUndefined();
    expect(body.agentMode).toBeUndefined();
  });

  it("body-provided session id reuses across different request contexts", () => {
    const credentials = { connectionId: "conn-a", rawHeaders: {} };
    const sessionId = captureSessionId({ session_id: "body-sess-1" }, credentials, "conn-a", "kiro");
    expect(credentials._clientSessionIsGenerated).toBe(false);
    const body = kiroBody(sessionId);
    const a = executor.transformRequest("claude-sonnet-4.5", body, true, credentials, requestContext());
    const b = executor.transformRequest("claude-sonnet-4.5", body, true, credentials, requestContext());

    expect(a.conversationState.agentContinuationId).toBe(b.conversationState.agentContinuationId);
  });

  it("passes payloads without a conversationState.conversationId through untouched", () => {
    expect(executor.transformRequest("claude-sonnet-4.5", { model: "m" }, true, { connectionId: "conn-a" }, requestContext()))
      .toEqual({ model: "m" });
  });
});

describe("resolveContinuationId", () => {
  it("reuses within the tuple for global sessions across request contexts", () => {
    const base = { sessionId: "s1", connectionId: "c1", model: "m1", scope: "kiro", requestScoped: false };
    const id = resolveContinuationId(base);

    expect(resolveContinuationId(base)).toBe(id);
    expect(resolveContinuationId({ ...base, sessionId: "s2" })).not.toBe(id);
    expect(resolveContinuationId({ ...base, connectionId: "c2" })).not.toBe(id);
    expect(resolveContinuationId({ ...base, model: "m2" })).not.toBe(id);
    expect(resolveContinuationId({ ...base, scope: "codex" })).not.toBe(id);
  });

  it("reuses within the tuple for request-scoped sessions sharing the same requestContext", () => {
    const ctx = Object.freeze({});
    const base = { sessionId: "s1", connectionId: "c1", model: "m1", scope: "kiro", requestContext: ctx };
    const id = resolveContinuationId(base);

    expect(resolveContinuationId(base)).toBe(id);
    expect(resolveContinuationId({ ...base, requestContext: Object.freeze({}) })).not.toBe(id);
    expect(resolveContinuationId({ ...base, sessionId: "s2" })).not.toBe(id);
    expect(resolveContinuationId({ ...base, connectionId: "c2" })).not.toBe(id);
    expect(resolveContinuationId({ ...base, model: "m2" })).not.toBe(id);
    expect(resolveContinuationId({ ...base, scope: "codex" })).not.toBe(id);
  });

  it("missing account/model/session/scope or requestContext yields an unstored one-shot id", () => {
    // A blank connectionId must NOT collapse all accounts into one shared
    // continuation bucket — incomplete identity gets no cache reuse at all.
    const ctx = Object.freeze({});
    const base = { sessionId: "s1", connectionId: "c1", model: "m1", scope: "kiro", requestContext: ctx };
    expect(resolveContinuationId({ ...base, connectionId: undefined }))
      .not.toBe(resolveContinuationId({ ...base, connectionId: undefined }));
    expect(resolveContinuationId({ ...base, model: "" }))
      .not.toBe(resolveContinuationId({ ...base, model: "" }));
    expect(resolveContinuationId({ ...base, sessionId: null }))
      .not.toBe(resolveContinuationId({ ...base, sessionId: null }));
    expect(resolveContinuationId({ ...base, scope: "" }))
      .not.toBe(resolveContinuationId({ ...base, scope: "" }));
    expect(resolveContinuationId({ ...base, requestContext: null }))
      .not.toBe(resolveContinuationId({ ...base, requestContext: null }));
    // One-shots are never stored: a later fully-keyed call is unaffected.
    expect(resolveContinuationId(base)).toBe(resolveContinuationId(base));
  });

  it("clears with the session store", () => {
    const ctx = Object.freeze({});
    const base = { sessionId: "s1", connectionId: "c1", model: "m1", scope: "kiro", requestContext: ctx };
    const id = resolveContinuationId(base);
    clearSessionStore();
    expect(resolveContinuationId(base)).not.toBe(id);
  });
});
