import { afterEach, expect, it, vi } from "vitest";
import { installStoryNetwork } from "../../.storybook/network.js";

let cleanup;
afterEach(async () => { if (cleanup) await cleanup(); cleanup = null; vi.unstubAllGlobals(); });

it("delivers property and listener callbacks once in native registration order", async () => {
  vi.stubGlobal("location", new URL("http://storybook.test"));
  cleanup = installStoryNetwork({ routes: { "GET /api/events": { events: [] } } });
  const source = new EventSource("/api/events");
  const calls = [];
  source.addEventListener("message", () => calls.push("first"));
  source.onmessage = () => calls.push("old");
  source.addEventListener("message", () => calls.push("last"));
  source.onmessage = function (event) { expect(this).toBe(source); calls.push(event.data); };
  source.dispatchEvent(new MessageEvent("message", { data: "replacement" }));
  expect(calls).toEqual(["first", "replacement", "last"]);
  calls.length = 0;
  source.onmessage = null;
  source.dispatchEvent(new MessageEvent("message", { data: "ignored" }));
  expect(calls).toEqual(["first", "last"]);
  source.close();
});

it("delivers scheduled stream data through native handler attributes", async () => {
  vi.stubGlobal("location", new URL("http://storybook.test"));
  cleanup = installStoryNetwork({ routes: { "GET /api/events": { events: [{ total: 3 }] } } });
  const source = new EventSource("/api/events");
  const messages = [];
  source.onmessage = (event) => messages.push(JSON.parse(event.data));
  await vi.waitFor(() => expect(messages).toEqual([{ total: 3 }]));
  source.close();
});

it("selects exact query fixtures before pathname defaults", async () => {
  vi.stubGlobal("location", new URL("http://storybook.test"));
  cleanup = installStoryNetwork({ routes: {
    "GET /api/rows": { body: { scope: "default" } },
    "GET /api/rows?period=7d": { body: { scope: "week" } },
  } });
  expect(await (await fetch("/api/rows?period=7d")).json()).toEqual({ scope: "week" });
  expect(await (await fetch("/api/rows?period=all")).json()).toEqual({ scope: "default" });
});
