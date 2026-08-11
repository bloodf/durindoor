import { describe, expect, it } from "vitest";
import { BodyReadTimeoutError, readBodyWithTimeout } from "../../open-sse/utils/bodyTimeout.js";

function hangingResponse(onCancel = () => {}) {
  return new Response(new ReadableStream({
    start() {},
    cancel: onCancel,
  }));
}

describe("readBodyWithTimeout", () => {
  it("returns a healthy text body", async () => {
    await expect(readBodyWithTimeout(new Response("healthy"), { timeoutMs: 10 }))
      .resolves.toBe("healthy");
  });

  it("cancels a hung body and raises its typed timeout", async () => {
    let reason;
    await expect(readBodyWithTimeout(hangingResponse((value) => { reason = value; }), { timeoutMs: 1 }))
      .rejects.toBeInstanceOf(BodyReadTimeoutError);
    expect(reason).toBe("provider error body timeout");
  });

  it("does not schedule a timeout when passed zero", async () => {
    let controller;
    const response = new Response(new ReadableStream({ start(value) { controller = value; } }));
    const pending = readBodyWithTimeout(response, { timeoutMs: 0 });
    await new Promise((resolve) => setTimeout(resolve, 5));
    controller.enqueue(new TextEncoder().encode("late but allowed"));
    controller.close();
    await expect(pending).resolves.toBe("late but allowed");
  });
});
