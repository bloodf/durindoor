import { describe, expect, it, vi } from "vitest";
import { FORMATS } from "open-sse/translator/formats.js";

const store = vi.hoisted(() => vi.fn().mockResolvedValue(true));
vi.mock("@/lib/db/repos/sessionCaptureRepo.js", async (original) => ({
  ...await original(), storeAdmittedCapture: store,
}));

import { prepareMessageCapture } from "@/sse/utils/messageCapture.js";

describe("OmniRoute 954553ab06b64b37b6fa93f58089614d218099f4 client-visible turn", () => {
  it("stores one turn from the response delivered to the client", async () => {
    store.mockClear();
    const request = new Request("http://localhost/v1/chat/completions", { headers: {
      "x-durindoor-capture": "true",
      "x-durindoor-capture-session": "550e8400-e29b-41d4-a716-446655440000",
    } });
    const capture = prepareMessageCapture({ request, body: { messages: [{ role: "user", content: "hello" }] },
      settings: { enableSessionCapture: true }, auth: { ok: true, stored: true, apiKeyId: "key-id" },
      credential: "fixture-key", format: FORMATS.OPENAI });
    const response = Response.json({ choices: [{ index: 0, message: { role: "assistant", content: "translated reply" }, finish_reason: "stop" }] });
    expect((await capture(response).json()).choices[0].message.content).toBe("translated reply");
    expect(store).toHaveBeenCalledTimes(1);
    expect(JSON.parse(store.mock.calls[0][0].content)).toEqual({ user: ["hello"], assistant: ["translated reply"] });
  });
});
