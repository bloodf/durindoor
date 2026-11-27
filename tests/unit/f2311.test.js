import { it, expect, vi } from "vitest";

import { readStreamLines } from "../../open-sse/executors/websession-utils.js";

it("cancels a pending stream read on abort", async () => {
  const cancel = vi.fn();
  const body = new ReadableStream({ pull() { return new Promise(() => {}); }, cancel });
  const controller = new AbortController();
  const reading = readStreamLines(body, { signal: controller.signal }).next();
  const assertion = expect(reading).rejects.toMatchObject({ name: "AbortError" });
  const timer = setTimeout(() => controller.abort(), 100);
  try {
    await assertion;
    expect(cancel).toHaveBeenCalledOnce();
  } finally { clearTimeout(timer); }
}, 1000);

it("yields every line from a normal stream", async () => {
  const body = new ReadableStream({ start(c) {
    c.enqueue(new TextEncoder().encode("one\ntwo\nlast")); c.close();
  } });
  const lines = [];
  for await (const line of readStreamLines(body)) lines.push(line);
  expect(lines).toEqual(["one", "two", "last"]);
});
