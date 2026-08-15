import { afterEach, expect, it, vi } from "vitest";
import { PerplexityWebExecutor } from "../../open-sse/executors/perplexity-web.js";

const originalFetch = global.fetch;
const ANSWER = "The Caspian Sea is the world's largest inland body of water.";

function mockPplxStream(events, splitFirstFrame = false) {
  const encoder = new TextEncoder();
  const frames = [...events.map((event) => `data: ${JSON.stringify(event)}\n\n`), "data: [DONE]\n\n"];
  if (splitFirstFrame) {
    const [first, ...rest] = frames;
    const splitAt = Math.floor(first.length / 2);
    frames.splice(0, frames.length, first.slice(0, splitAt), first.slice(splitAt), ...rest);
  }
  let index = 0;
  return new Response(new ReadableStream({
    pull(controller) {
      if (index === frames.length) controller.close();
      else controller.enqueue(encoder.encode(frames[index++]));
    },
  }), { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

async function answerFor(events, splitFirstFrame = false) {
  global.fetch = vi.fn(async () => mockPplxStream(events, splitFirstFrame));
  const { response } = await new PerplexityWebExecutor().execute({
    model: "pplx-auto",
    body: { messages: [{ role: "user", content: "Where is the Caspian Sea?" }], stream: false },
    stream: false,
    credentials: { apiKey: "session" },
  });
  return (await response.json()).choices[0].message.content;
}

async function streamDeltasFor(events) {
  global.fetch = vi.fn(async () => mockPplxStream(events));
  const { response } = await new PerplexityWebExecutor().execute({
    model: "pplx-auto",
    body: { messages: [{ role: "user", content: "Where is the Caspian Sea?" }], stream: true },
    stream: true,
    credentials: { apiKey: "session" },
  });
  return (await response.text())
    .split("\n")
    .filter((line) => line.startsWith("data: {"))
    .map((line) => JSON.parse(line.slice(6)).choices[0].delta.content)
    .filter((content) => typeof content === "string");
}

afterEach(() => { global.fetch = originalFetch; });

it("extracts answer chunks from workflow_block diff patches", async () => {
  const answer = await answerFor([
    {
      status: "PENDING",
      blocks: [{
        intended_usage: "workflow_root",
        diff_block: {
          field: "workflow_block",
          patches: [{
            op: "add", path: "/steps/1", value: { items: [{ variant: "answer", payload: { text_payload: { variant: "answer", chunks: ["The Caspian "] } } }] },
          }],
        },
      }],
    },
    {
      status: "COMPLETED",
      blocks: [{
        intended_usage: "workflow_root",
        diff_block: {
          field: "workflow_block",
          patches: [{ op: "add", path: "/steps/1/items/0/payload/text_payload/chunks/1", value: "Sea is the world's largest inland body of water." }],
        },
      }],
    },
  ]);

  expect(answer).toBe(ANSWER);
});

it("extracts materialized workflow answers but ignores thinking items", async () => {
  const answer = await answerFor([{
    status: "COMPLETED",
    blocks: [{
      intended_usage: "workflow_root",
      workflow_block: {
        steps: [{ items: [
          { variant: "thinking", payload: { text_payload: { variant: "thinking", chunks: ["Searching the web"] } } },
          { variant: "answer", payload: { text_payload: { variant: "answer", text: ANSWER } } },
        ] }],
      },
    }],
  }]);

  expect(answer).toBe(ANSWER);
});

it("keeps legacy markdown_block answers", async () => {
  const answer = await answerFor([{
    status: "COMPLETED",
    blocks: [{ intended_usage: "markdown", markdown_block: { chunks: [ANSWER], progress: "DONE" } }],
  }]);

  expect(answer).toBe(ANSWER);
});

it("parses a workflow answer when its SSE event spans multiple Uint8Array reads", async () => {
  const answer = await answerFor([{
    status: "COMPLETED",
    blocks: [{
      intended_usage: "workflow_root",
      workflow_block: {
        steps: [{ items: [{ variant: "answer", payload: { text_payload: { variant: "answer", chunks: [ANSWER] } } }] }],
      },
    }],
  }], true);

  expect(answer).toBe(ANSWER);
});

it("seeds an answer track unconditionally even with empty chunks/text", async () => {
  const answer = await answerFor([
    {
      status: "PENDING",
      blocks: [{
        intended_usage: "workflow_root",
        diff_block: {
          field: "workflow_block",
          patches: [{
            op: "add", path: "/steps/2/items/0", value: { variant: "answer", payload: { text_payload: { variant: "answer", chunks: [] } } },
          }],
        },
      }],
    },
    {
      status: "COMPLETED",
      blocks: [{
        intended_usage: "workflow_root",
        diff_block: {
          field: "workflow_block",
          patches: [{ op: "add", path: "/steps/2/items/0/payload/text_payload/chunks/0", value: "Hello" }],
        },
      }],
    },
  ]);

  expect(answer).toBe("Hello");
});

it("selects the single longest answer track instead of concatenating every track", async () => {
  const answer = await answerFor([{
    status: "COMPLETED",
    blocks: [{
      intended_usage: "workflow_root",
      workflow_block: {
        steps: [
          { items: [{ variant: "answer", payload: { text_payload: { variant: "answer", chunks: ["Short"] } } }] },
          { items: [{ variant: "answer", payload: { text_payload: { variant: "answer", text: ANSWER } } }] },
        ],
      },
    }],
  }]);

  expect(answer).toBe(ANSWER);
  expect(answer).not.toContain("Short");
});

it("streams monotone prefix-stable deltas, ignoring a hostile chunk index and a shorter sibling track", async () => {
  const deltas = await streamDeltasFor([
    {
      status: "PENDING",
      blocks: [{
        intended_usage: "workflow_root",
        diff_block: {
          field: "workflow_block",
          patches: [
            { op: "add", path: "/steps/3/items/0", value: { variant: "answer", payload: { text_payload: { variant: "answer", chunks: [] } } } },
            { op: "add", path: "/steps/0/items/0", value: { variant: "answer", payload: { text_payload: { variant: "answer", chunks: ["IGNORE"] } } } },
          ],
        },
      }],
    },
    {
      status: "PENDING",
      blocks: [{
        intended_usage: "workflow_root",
        diff_block: {
          field: "workflow_block",
          patches: [
            { op: "add", path: "/steps/3/items/0/payload/text_payload/chunks/1", value: "must be ignored" },
            { op: "add", path: "/steps/3/items/0/payload/text_payload/chunks/9007199254740992", value: "must be ignored" },
          ],
        },
      }],
    },
    {
      status: "PENDING",
      blocks: [{
        intended_usage: "workflow_root",
        diff_block: {
          field: "workflow_block",
          patches: [{ op: "add", path: "/steps/3/items/0/payload/text_payload/chunks/0", value: "The " }],
        },
      }],
    },
    {
      status: "COMPLETED",
      blocks: [{
        intended_usage: "workflow_root",
        diff_block: {
          field: "workflow_block",
          patches: [{ op: "add", path: "/steps/3/items/0/payload/text_payload/chunks/1", value: "final answer." }],
        },
      }],
    },
  ]);

  expect(deltas.length).toBeGreaterThan(1);
  const joined = deltas.join("");
  expect(joined).toBe("The final answer.");
  expect(joined).not.toContain("No");
  expect(joined).not.toContain("must be ignored");
});

it("copies seeded chunks defensively before applying a same-track patch", async () => {
  const chunks = [42, " chars"];
  const answer = await answerFor([
    {
      status: "PENDING",
      blocks: [{
        intended_usage: "workflow_root",
        workflow_block: {
          steps: [{ items: [{ variant: "answer", payload: { text_payload: { variant: "answer", chunks } } }] }],
        },
      }],
    },
    {
      status: "COMPLETED",
      blocks: [{
        intended_usage: "workflow_root",
        diff_block: {
          field: "workflow_block",
          patches: [{ op: "replace", path: "/steps/0/items/0/payload/text_payload/chunks/1", value: " patched" }],
        },
      }],
    },
  ]);

  expect(answer).toBe("42 patched");
  expect(chunks).toEqual([42, " chars"]);
});

it("uses chunks over text and never emits tails from divergent workflow snapshots", async () => {
  const events = [
    {
      status: "PENDING",
      blocks: [{ intended_usage: "workflow_root", workflow_block: { steps: [{ items: [{ variant: "answer", payload: { text_payload: { variant: "answer", chunks: [], text: "fallback" } } }] }] } }],
    },
    {
      status: "PENDING",
      blocks: [{ intended_usage: "workflow_root", diff_block: { field: "workflow_block", patches: [{ op: "add", path: "/steps/0/items/0/payload/text_payload/chunks/0", value: "The cat" }] } }],
    },
    {
      status: "PENDING",
      blocks: [{ intended_usage: "workflow_root", workflow_block: { steps: [{ items: [{ variant: "answer", payload: { text_payload: { variant: "answer", chunks: ["The cats"] } } }] }] } }],
    },
    {
      status: "PENDING",
      blocks: [{ intended_usage: "workflow_root", workflow_block: { steps: [{ items: [{ variant: "answer", payload: { text_payload: { variant: "answer", chunks: ["A dog"] } } }] }] } }],
    },
    {
      status: "COMPLETED",
      blocks: [{ intended_usage: "workflow_root", workflow_block: { steps: [{ items: [{ variant: "answer", payload: { text_payload: { variant: "answer", chunks: ["A"] } } }] }] } }],
    },
  ];

  expect(await streamDeltasFor(events)).toEqual(["The cat", "s"]);
  expect(await answerFor(events)).toBe("The cats");
});

it("caps hostile workflow answer tracks but updates an existing selected track", async () => {
  const answerItem = (chunks = []) => ({ variant: "answer", payload: { text_payload: { variant: "answer", chunks } } });
  const steps = Array.from({ length: 129 }, () => ({ items: [answerItem()] }));
  steps.reverse();

  const events = [
    {
      status: "PENDING",
      blocks: [{ intended_usage: "workflow_root", workflow_block: { steps } }],
    },
    {
      status: "PENDING",
      blocks: [{
        intended_usage: "workflow_root",
        diff_block: {
          field: "workflow_block",
          patches: [
            { op: "add", path: "/steps/1000/items/0", value: answerItem(["ignored"]) },
            { op: "add", path: "/steps/1001", value: { items: [answerItem(["ignored"]) ] } },
            { op: "add", path: "/steps/0/items/0/payload/text_payload/chunks/0", value: "kept" },
          ],
        },
      }],
    },
  ];

  expect(await answerFor(events)).toBe("kept");
});
