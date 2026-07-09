/**
 * Unit tests for thinkStripper.
 *
 * MiniMax M3 inlines reasoning as `<think>...</think>` XML tags inside the
 * `content` field of its OpenAI-format responses. `extractThinkTags()` moves
 * that reasoning into the `reasoning_content` field so clients can display it
 * without leaking raw XML tags into the visible reply.
 */

import { describe, it, expect } from "vitest";
import { extractThinkTags, stripThinkTags } from "../../open-sse/utils/thinkStripper.js";

describe("extractThinkTags", () => {
  it("moves reasoning from <think> tags into reasoning_content", () => {
    const { content, reasoning } = extractThinkTags("before <think>hidden</think> after");
    expect(reasoning).toBe("hidden");
    expect(content).toBe("before after");
  });

  it("returns the original content when no think tags are present", () => {
    const text = "just a normal response";
    const { content, reasoning } = extractThinkTags(text);
    expect(reasoning).toBeNull();
    expect(content).toBe(text);
  });

  it("handles content that is entirely inside think tags", () => {
    const { content, reasoning } = extractThinkTags("<think>only reasoning</think>");
    expect(reasoning).toBe("only reasoning");
    expect(content).toBe("");
  });

  it("strips leading whitespace left behind by </think>", () => {
    const { content, reasoning } = extractThinkTags("<think>reason</think>   visible");
    expect(reasoning).toBe("reason");
    expect(content).toBe("visible");
  });

  it("ignores non-string inputs", () => {
    const { content, reasoning } = extractThinkTags(null);
    expect(reasoning).toBeNull();
    expect(content).toBeNull();
  });
});

describe("stripThinkTags", () => {
  it("removes think tags and trailing whitespace", () => {
    expect(stripThinkTags("a <think>b</think> c")).toBe("a c");
  });

  it("leaves text without tags unchanged", () => {
    expect(stripThinkTags("no tags here")).toBe("no tags here");
  });
});
