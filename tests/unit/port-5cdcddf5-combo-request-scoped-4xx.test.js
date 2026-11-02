// Port of upstream 9router 5cdcddf5 (#5057): a request-scoped 4xx from one combo
// member advances to the next member instead of ending the combo; if every
// member rejects, the client gets the first rejecting member's own response.
import { beforeEach, describe, expect, it } from "vitest";
import { handleComboChat, resetComboRotation } from "../../open-sse/services/combo.js";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";

const log = { info() {}, warn() {}, error() {}, debug() {} };
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const ok = (text) => json(200, { choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } });

async function runCombo(responders) {
  const attempted = [];
  const response = await handleComboChat({
    body: { model: "combo", stream: false, messages: [{ role: "user", content: "hi" }] },
    models: Object.keys(responders),
    handleSingleModel: async (_body, model) => {
      attempted.push(model);
      return responders[model]();
    },
    log,
    comboName: "request-scoped-test",
    comboStrategy: "fallback",
  });
  return { attempted, response };
}

beforeEach(() => resetComboRotation());

describe("checkFallbackError requestScoped", () => {
  it("marks unmatched 4xx and invalid_request_error 400 as request-scoped without account fallback", () => {
    expect(checkFallbackError(400, "Bad request")).toMatchObject({ shouldFallback: false, cooldownMs: 0, requestScoped: true });
    expect(checkFallbackError(422, "unsupported parameter: foo")).toMatchObject({ shouldFallback: false, requestScoped: true });
    expect(checkFallbackError(400, JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "prompt is too long" } })))
      .toMatchObject({ shouldFallback: false, cooldownMs: 0, requestScoped: true });
  });

  it("does not mark account-scoped, transient, or abort statuses", () => {
    expect(checkFallbackError(401, "unauthorized").requestScoped).toBeUndefined();
    expect(checkFallbackError(429, "rate limit").requestScoped).toBeUndefined();
    expect(checkFallbackError(503, "overloaded").requestScoped).toBeUndefined();
    expect(checkFallbackError(499, "client closed").requestScoped).toBeUndefined();
  });
});

describe("combo advances past a request-scoped 4xx (5cdcddf5)", () => {
  it("serves from the next member after a validation 400", async () => {
    const { attempted, response } = await runCombo({
      "p1/first": () => json(400, { error: { message: "unsupported parameter: reasoning_effort" } }),
      "p2/second": () => ok("served"),
    });
    expect(attempted).toEqual(["p1/first", "p2/second"]);
    expect(response.status).toBe(200);
    expect((await response.json()).choices[0].message.content).toBe("served");
  });

  it("returns the first rejecting member's own status and body when every member rejects", async () => {
    const { attempted, response } = await runCombo({
      "p1/first": () => json(400, { error: { message: "context too long for first" } }),
      "p2/second": () => json(422, { error: { message: "second rejected" } }),
    });
    expect(attempted).toEqual(["p1/first", "p2/second"]);
    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toBe("context too long for first");
  });

  it("still stops on a non-request-scoped terminal error", async () => {
    const { attempted, response } = await runCombo({
      "p1/first": () => json(499, { error: { message: "client closed request" } }),
      "p2/second": () => ok("should not run"),
    });
    expect(attempted).toEqual(["p1/first"]);
    expect(response.status).toBe(499);
  });
});
