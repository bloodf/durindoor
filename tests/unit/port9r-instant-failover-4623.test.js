import { describe, expect, it, vi } from "vitest";
import { handleComboChat } from "../../open-sse/services/combo.js";

const log = { info() {}, warn() {}, error() {}, debug() {} };

describe("transient combo failover (#4623)", () => {
  it.each([502, 503, 504])("tries the next member without a cooldown delay after %s", async (status) => {
    vi.useFakeTimers();
    try {
      const calls = [];
      const pending = handleComboChat({
        body: { messages: [{ role: "user", content: "hello" }] },
        models: ["p1/first", "p2/second"], comboStrategy: "fallback", comboName: `instant-${status}`, log,
        handleSingleModel: async (_body, model) => {
          calls.push(model);
          return model === "p1/first" ? Response.json({ error: { message: "unavailable" } }, { status }) : Response.json({ text: "ok" });
        },
      });
      for (let i = 0; i < 30 && calls.length < 2; i++) await Promise.resolve();
      expect(calls).toEqual(["p1/first", "p2/second"]);
      expect((await pending).status).toBe(200);
    } finally { vi.useRealTimers(); }
  });
});
