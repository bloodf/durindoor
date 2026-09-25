// Port of OmniRoute #14122: CITATION_RE stripped any [n] token from the whole
// answer, so array subscripts spelled exactly like a citation marker
// (`arr[0]`) were removed from code output too — including inside <tool>
// call arguments, corrupting generated code on disk, not just the rendered
// prose. cleanResponse() now skips fenced code blocks, <tool> payloads, and
// inline code spans when stripping citations; prose citation cleanup is
// unchanged.
import { describe, expect, it } from "vitest";
import { cleanResponse } from "../../open-sse/executors/perplexity-web.js";

describe("port 14122 — keep array subscripts in perplexity-web code output", () => {
  it("keeps subscripts inside a fenced code block", () => {
    const input = "Here you go:\n```python\nprint(arr[0], arr[12])\n```";
    expect(cleanResponse(input)).toBe("Here you go:\n```python\nprint(arr[0], arr[12])\n```");
  });

  it("keeps a list literal inside a fenced code block", () => {
    const input = "```python\nx = [0]\n```";
    expect(cleanResponse(input)).toBe("```python\nx = [0]\n```");
  });

  it("keeps subscripts inside an inline code span", () => {
    const input = "Use `arr[0]` to get the first item [1].";
    expect(cleanResponse(input)).toBe("Use `arr[0]` to get the first item .");
  });

  it("keeps subscripts inside a <tool> payload", () => {
    const input = '<tool>write_file{"path":"a.py","content":"arr[0] + m[12]"}</tool>';
    expect(cleanResponse(input)).toBe(input);
  });

  it("still strips ordinary prose citations", () => {
    expect(cleanResponse("text [1] more")).toBe("text more");
    expect(cleanResponse("text[4] more")).toBe("text more");
    expect(cleanResponse("text [3].")).toBe("text .");
  });

  it("strips citations immediately before and after a protected region", () => {
    const input = "before [1] `arr[0]` after [2]";
    expect(cleanResponse(input)).toBe("before `arr[0]` after");
  });

  it("protects an unterminated fenced block from a stream cut off mid-answer", () => {
    const input = "```py\nz = c[7]";
    expect(cleanResponse(input, false)).toBe("```py\nz = c[7]");
  });

  it("protects an unterminated <tool> block from a stream cut off mid-answer", () => {
    const input = "<tool>write_file{arr[0]";
    expect(cleanResponse(input, false)).toBe("<tool>write_file{arr[0]");
  });
});
