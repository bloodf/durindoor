import { describe, expect, it, vi } from "vitest";
import { readTextStream, withTimeoutSignal } from "../../open-sse/executors/websession-utils.js";

function delayedBody() {
  let timer;
  const cancel = vi.fn(() => clearTimeout(timer));
  const body = new ReadableStream({
    start(controller) {
      timer = setTimeout(() => {
        controller.enqueue(new TextEncoder().encode("late"));
        controller.close();
      }, 50);
    },
    cancel,
  });
  return { body, cancel };
}

describe("readTextStream abort handling", () => {
  it("rejects with the caller abort reason and cancels a pending read", async () => {
    const controller = new AbortController();
    const { body, cancel } = delayedBody();
    const timer = setTimeout(() => controller.abort(), 10);
    try {
      await expect(readTextStream(body, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
      expect(cancel).toHaveBeenCalledOnce();
    } finally {
      clearTimeout(timer);
    }
  });

  it("rejects with the timeout reason and cancels a pending read", async () => {
    const signal = withTimeoutSignal(undefined, 10);
    const { body, cancel } = delayedBody();
    await expect(readTextStream(body, signal)).rejects.toMatchObject({ name: "TimeoutError" });
    expect(signal.reason.name).toBe("TimeoutError");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("returns the full text of a normal body", async () => {
    const body = new ReadableStream({
      start(controller) {
        const bytes = new TextEncoder().encode("Olá mundo");
        controller.enqueue(bytes.slice(0, 3));
        controller.enqueue(bytes.slice(3));
        controller.close();
      },
    });
    await expect(readTextStream(body)).resolves.toBe("Olá mundo");
  });
});
