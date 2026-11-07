// Kiro session affinity after dropping the deprecated agent fields (#755, upstream 9router#3776).
//
// KiroExecutor.transformRequest no longer stamps agentMode, agentContinuationId or
// agentTaskType. Affinity rests on conversationState.conversationId, which the
// translators derive from resolveSessionId per (scope, connectionId, session id).
// Unverified: no live Kiro call was made; the 400 REQUEST_BODY_INVALID is from the issue text.
//
// Run: node node_modules/vitest/vitest.mjs run unit/kiro-session-affinity.test.js

import { describe, it, expect, beforeEach } from "vitest";
import { KiroExecutor } from "../../open-sse/executors/kiro.js";
import { clearSessionStore } from "../../open-sse/utils/sessionManager.js";
import { openaiToKiroRequest } from "../../open-sse/translator/request/openai-to-kiro.js";

const executor = new KiroExecutor();
const MODEL = "claude-sonnet-4.5";

function kiroBody(conversationId) {
  return {
    conversationState: {
      chatTriggerType: "MANUAL",
      conversationId,
      currentMessage: { userInputMessage: { content: "hi", modelId: MODEL, origin: "AI_EDITOR" } },
      history: [],
    },
  };
}

const translate = (sessionHeader, connectionId) => {
  const credentials = { connectionId, rawHeaders: { "x-session-id": sessionHeader } };
  const body = openaiToKiroRequest(MODEL, { model: MODEL, messages: [{ role: "user", content: "hello" }] }, true, credentials);
  return executor.transformRequest(MODEL, body, true, credentials);
};

beforeEach(() => clearSessionStore());

describe("kiro payload carries no deprecated agent fields", () => {
  it("omits agentMode, agentContinuationId and agentTaskType and keeps the conversation id", () => {
    const out = executor.transformRequest(MODEL, kiroBody("sess-1"), true, { connectionId: "conn-a", rawHeaders: { "x-session-id": "sess-1" } });
    expect(out.agentMode).toBeUndefined();
    expect(out.conversationState.agentContinuationId).toBeUndefined();
    expect(out.conversationState.agentTaskType).toBeUndefined();
    expect(out.conversationState.conversationId).toBe("sess-1");
  });

  it("does not add them on retry or fallback re-dispatch either", () => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const out = executor.transformRequest(MODEL, kiroBody("sess-1"), true, { connectionId: "conn-a", rawHeaders: { "x-session-id": "sess-1" } }, Object.freeze({ clientHeaders: {} }));
      expect(JSON.stringify(out)).not.toMatch(/agentMode|agentContinuationId|agentTaskType/);
    }
  });

  it("passes payloads without a conversationId through untouched", () => {
    expect(executor.transformRequest(MODEL, { model: "m" }, true, { connectionId: "conn-a" })).toEqual({ model: "m" });
  });
});

describe("kiro session affinity via conversationId", () => {
  it("same client session on the same account keeps the same conversation id", () => {
    expect(translate("client-sess-1", "conn-a").conversationState.conversationId)
      .toBe(translate("client-sess-1", "conn-a").conversationState.conversationId);
  });

  it("a different client session gets a different conversation id", () => {
    expect(translate("client-sess-1", "conn-a").conversationState.conversationId)
      .not.toBe(translate("client-sess-2", "conn-a").conversationState.conversationId);
  });

  it("an explicit client session id is forwarded as the conversation id on every account", () => {
    // Behaviour change: the per-(account, model) continuation id used to keep these apart.
    // Conversations are scoped by the credential upstream, so the payload no longer does it.
    expect(translate("client-sess-1", "conn-a").conversationState.conversationId).toBe("client-sess-1");
    expect(translate("client-sess-1", "conn-b").conversationState.conversationId).toBe("client-sess-1");
  });
});

describe("kiro sessions with no client session id", () => {
  // The translators fall back to one per-connection id for every such session; the executor
  // must not let unrelated sessions on one account share a conversationId.
  const generated = (ctx) => executor.transformRequest(MODEL, kiroBody("per-connection-id"), true, { connectionId: "conn-a", _clientSessionIsGenerated: true }, ctx);

  it("gives unrelated inbound requests on the same account different conversation ids", () => {
    const a = generated(Object.freeze({ clientHeaders: {} }));
    const b = generated(Object.freeze({ clientHeaders: {} }));
    expect(a.conversationState.conversationId).not.toBe("per-connection-id");
    expect(a.conversationState.conversationId).not.toBe(b.conversationState.conversationId);
  });

  it("keeps one id across retries and endpoint fallbacks of the same inbound request", () => {
    const ctx = Object.freeze({ clientHeaders: {} });
    expect(generated(ctx).conversationState.conversationId).toBe(generated(ctx).conversationState.conversationId);
  });

  it("mints a fresh id when there is no request context", () => {
    expect(generated(null).conversationState.conversationId).not.toBe(generated(null).conversationState.conversationId);
  });

  it("end to end: two headerless translations never share a conversation id", () => {
    const credentials = { connectionId: "conn-a", rawHeaders: {} };
    const make = () => {
      const translated = openaiToKiroRequest(MODEL, { model: MODEL, messages: [{ role: "user", content: "hello" }] }, true, credentials);
      return executor.transformRequest(MODEL, translated, true, credentials, Object.freeze({ clientHeaders: {} }));
    };
    expect(make().conversationState.conversationId).not.toBe(make().conversationState.conversationId);
  });
});

describe("kiro systemPrompt handling is unchanged", () => {
  const body = () => ({ ...kiroBody("sess-1"), systemPrompt: "be brief" });

  it("strips the top-level systemPrompt only for the kiro.dev gateway, without mutating the caller", () => {
    const input = body();
    const out = executor.transformRequest(MODEL, input, true, {}, null, "https://runtime.us-east-1.kiro.dev/generateAssistantResponse");
    expect(out.systemPrompt).toBeUndefined();
    expect(input.systemPrompt).toBe("be brief");
    expect(executor.transformRequest(MODEL, body(), true, {}, null, "https://q.us-east-1.amazonaws.com/").systemPrompt).toBe("be brief");
  });
});
