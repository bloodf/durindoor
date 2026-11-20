import { describe, expect, it } from "vitest";
import { OpenCodeExecutor } from "../../open-sse/executors/opencode.js";

describe("OpenCode overload retry policy", () => {
  const executor = new OpenCodeExecutor();

  it("backs off an explicit capacity rejection and leaves its body readable", async () => {
    const response = new Response("The inference service is overloaded.", { status: 429 });
    expect(await executor.computeRetryDelay(response, 2, 800)).toBe(1600);
    expect(await response.text()).toBe("The inference service is overloaded.");
  });

  it.each(["FreeUsageLimitError", "quota exceeded", "unknown error"])("retains the rejection for %s", async (error) => {
    expect(await executor.computeRetryDelay(new Response(error, { status: 429 }), 1, 800)).toBe(false);
  });

  it("leaves other transport retry delays in place", async () => {
    expect(await executor.computeRetryDelay(new Response(null, { status: 502 }), 1, 500)).toBe(500);
  });
});
