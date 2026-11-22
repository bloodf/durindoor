import { describe, it, expect } from "vitest";
import { handleComboChat } from "../../open-sse/services/combo.js";

// Upstream decolua/9router #3873: when every combo member fails, the reported
// status must belong to the same failure as the reported message.

const log = { info() {}, warn() {}, error() {}, debug() {} };

const failure = (status, message) =>
  new Response(JSON.stringify({ error: { type: "server_error", message } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });

async function runCombo(models, responder, comboName) {
  const tried = [];
  const res = await handleComboChat({
    body: { messages: [] },
    models,
    handleSingleModel: async (_body, modelStr) => {
      tried.push(modelStr);
      return responder(modelStr);
    },
    log,
    comboName,
    comboStrategy: "priority",
  });
  let body = null;
  try {
    body = await res.clone().json();
  } catch {
    /* non-JSON body */
  }
  return { tried, status: res.status, message: body?.error?.message ?? null };
}

describe("combo failure status/message pairing (#3873)", () => {
  it("pairs the reported status with the last model's message", async () => {
    const { tried, status, message } = await runCombo(
      ["a/m1", "b/m2", "c/m3"],
      (m) =>
        m === "a/m1" ? failure(500, "first said 500")
          : m === "b/m2" ? failure(502, "gateway said 502")
            : failure(504, "last one said 504"),
      "pairing-3873"
    );
    expect(tried).toEqual(["a/m1", "b/m2", "c/m3"]);
    expect({ status, message }).toEqual({ status: 504, message: "last one said 504" });
  });

  it("keeps an authentication failure and its own message as the reported cause", async () => {
    const { status, message } = await runCombo(
      ["a/m1", "b/m2"],
      (m) => (m === "a/m1" ? failure(401, "bad credentials") : failure(500, "later 500")),
      "auth-3873"
    );
    expect({ status, message }).toEqual({ status: 401, message: "bad credentials" });
  });

  it("pairs a thrown error with the 500 it is reported as", async () => {
    const { status, message } = await runCombo(
      ["a/m1", "b/m2"],
      (m) => {
        if (m === "a/m1") return failure(502, "bad gateway");
        throw new Error("adapter exploded");
      },
      "threw-3873"
    );
    expect({ status, message }).toEqual({ status: 500, message: "adapter exploded" });
  });
});
