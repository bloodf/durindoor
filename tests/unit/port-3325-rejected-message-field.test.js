import { expect, it, describe } from "vitest";
import { findRejectedMessageField } from "../../open-sse/config/providerFieldStrips.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";

const groqError = (field) => JSON.stringify({ error: { message: `'messages.1' : for 'role:assistant' the following must be satisfied[('messages.1' : property '${field}' is unsupported)]` } });
const mistralError = (field) => JSON.stringify({ message: { detail: [{ type: "extra_forbidden", loc: ["body", "messages", 1, "assistant", field] }] } });

function history() {
  return {
    messages: [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello", annotations: [], refusal: null },
      { role: "user", content: "again" },
    ],
  };
}

async function run(rejection, status) {
  const requests = [];
  const body = history();
  const result = await new DefaultExecutor("openai-compatible-chat-strict").execute({
    model: "strict-model", body, stream: false,
    credentials: { apiKey: "test", providerSpecificData: { baseUrl: "https://strict.example.test/v1" } },
    requestPolicy: { maxTransportAttempts: 4 },
    directFetch: async (_url, init) => {
      requests.push(JSON.parse(init.body));
      return requests.length === 1 ? new Response(rejection, { status }) : Response.json({ ok: true });
    },
  });
  return { requests, result, body };
}

describe("port(upstream): #3325 - strip a rejected assistant message field and retry", () => {
  it.each([
    ["400 property message", groqError("annotations"), 400],
    ["422 structured path", mistralError("annotations"), 422],
  ])("retries without the named field after a %s", async (_label, rejection, status) => {
    const { requests, result, body } = await run(rejection, status);
    expect(result.response.status).toBe(200);
    expect(requests).toHaveLength(2);
    expect(requests[0].messages[1]).toHaveProperty("annotations");
    expect(requests[1].messages[1]).toEqual({ role: "assistant", content: "hello", refusal: null });
    expect(requests[1].messages[0]).toEqual({ role: "user", content: "hi" });
    // The caller's history is not mutated.
    expect(body.messages[1]).toHaveProperty("annotations");
  });

  it("never drops a field the conversation depends on", async () => {
    const { requests, result } = await run(groqError("content"), 400);
    expect(result.response.status).toBe(400);
    expect(requests).toHaveLength(1);
  });

  it("matches only a field present on an assistant turn", () => {
    expect(findRejectedMessageField(400, groqError("reasoning_content"), history())).toBeNull();
    expect(findRejectedMessageField(400, groqError("annotations"), { input: [] })).toBeNull();
    // A 422 may echo user content, so prose is never trusted there.
    expect(findRejectedMessageField(422, groqError("annotations"), history())).toBeNull();
    expect(findRejectedMessageField(422, mistralError("tool_calls"), history())).toBeNull();
  });
});
