// OmniRoute #18784 (pinned f93fc9f4): bound Responses -> Chat tool-output image re-injection.
// Offline: small synthetic data URLs and pure translation only.
import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { stripUnsupportedModalities } from "../../open-sse/translator/concerns/modality.js";
import { MAX_TOOL_OUTPUT_IMAGES, MAX_TOOL_OUTPUT_IMAGE_BYTES, boundToolOutputImages } from "../../open-sse/translator/request/openai-responses.js";
import { MAX_IMAGE_BYTES } from "../../open-sse/config/mediaConfig.js";

const R2O = (body) => translateRequest(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, "m", body, true, null, null);
const img = (tag) => `data:image/png;base64,${tag}`;
const turn = (id, url, text = `out-${id}`) => [
  { type: "function_call", call_id: id, name: "shot", arguments: "{}" },
  { type: "function_call_output", call_id: id, output: [{ type: "input_text", text }, { type: "input_image", image_url: url }] },
  { type: "message", role: "assistant", content: [{ type: "output_text", text: `after-${id}` }] },
];
const userImageMessages = (out) => out.messages.filter((m) => m.role === "user" && Array.isArray(m.content));
const urls = (out) => userImageMessages(out).flatMap((m) => m.content).filter((p) => p.type === "image_url").map((p) => p.image_url.url);
const textOf = (m) => (Array.isArray(m.content) ? m.content.filter((p) => p.type === "text").map((p) => p.text) : [m.content]);
const notes = (out) => out.messages.filter((m) => m.role === "user").flatMap(textOf).filter((t) => /^\[Earlier tool output image omitted/.test(t));

describe("#1073 bounded tool-output image restoration", () => {
  it("derives the byte budget from the existing per-image ceiling", () => {
    expect(MAX_TOOL_OUTPUT_IMAGE_BYTES).toBe(2 * MAX_IMAGE_BYTES);
    expect(MAX_TOOL_OUTPUT_IMAGES).toBe(16);
  });

  it("leaves a history within bounds unchanged and in order", () => {
    const input = [1, 2, 3].flatMap((n) => turn(`c${n}`, img(`AAA${n}`)));
    const out = R2O({ input });
    expect(urls(out)).toEqual([img("AAA1"), img("AAA2"), img("AAA3")]);
    expect(notes(out)).toEqual([]);
  });

  it("keeps the newest images under the count cap and notes the dropped ones in place", () => {
    const total = MAX_TOOL_OUTPUT_IMAGES + 3;
    const input = Array.from({ length: total }, (_, i) => turn(`c${i}`, img(`I${i}`))).flat();
    const out = R2O({ input });
    expect(urls(out)).toEqual(Array.from({ length: MAX_TOOL_OUTPUT_IMAGES }, (_, i) => img(`I${i + 3}`)));
    expect(notes(out)).toEqual([0, 1, 2].map((i) => `[Earlier tool output image omitted to bound request size (tool_call_id: c${i})]`));
    // Tool message text is untouched for dropped images.
    const toolText = out.messages.filter((m) => m.role === "tool").map((m) => m.content);
    expect(toolText[0]).toContain("out-c0");
    expect(toolText).toHaveLength(total);
  });

  // Pure boundary checks with a tiny explicit budget (the fixed default is 2 * MAX_IMAGE_BYTES).
  const group = (callId, url) => {
    const part = { type: "image_url", image_url: { url, detail: "auto" } };
    return { message: { role: "user", content: [part] }, entries: [{ part, callId }] };
  };
  const note = (id) => ({ type: "text", text: `[Earlier tool output image omitted to bound request size (tool_call_id: ${id})]` });

  it("keeps images exactly at the byte budget", () => {
    const groups = [group("a", "x".repeat(5)), group("b", "y".repeat(5))];
    boundToolOutputImages(groups, 16, 10);
    expect(groups.map((g) => g.message.content[0].type)).toEqual(["image_url", "image_url"]);
  });

  it("drops oldest first when one byte over the budget", () => {
    const groups = [group("a", "x".repeat(5)), group("b", "y".repeat(6))];
    boundToolOutputImages(groups, 16, 10);
    expect(groups[0].message.content).toEqual([note("a")]);
    expect(groups[1].message.content[0].type).toBe("image_url");
  });

  it("does not let a smaller older image survive a newer dropped one", () => {
    const groups = [group("small", "s"), group("big", "B".repeat(20)), group("new", "n")];
    boundToolOutputImages(groups, 16, 10);
    expect(groups.map((g) => g.message.content[0].type)).toEqual(["text", "text", "image_url"]);
    expect(groups[1].message.content).toEqual([note("big")]);
  });

  it("drops a single newest image larger than the whole budget and keeps nothing older", () => {
    const groups = [group("old", "o"), group("huge", "H".repeat(11))];
    boundToolOutputImages(groups, 16, 10);
    expect(groups.map((g) => g.message.content)).toEqual([[note("old")], [note("huge")]]);
  });

  it("keeps multi-image groups in order while trimming a prefix", () => {
    const part = (u) => ({ type: "image_url", image_url: { url: u, detail: "auto" } });
    const message = { role: "user", content: [part("1"), part("2"), part("3")] };
    boundToolOutputImages([{ message, entries: message.content.map((p, i) => ({ part: p, callId: `c${i}` })) }], 2, 100);
    expect(message.content).toEqual([note("c0"), part("2"), part("3")]);
  });

  it("never drops images the user attached to their own messages", () => {
    const input = [
      { type: "message", role: "user", content: [{ type: "input_image", image_url: img("USER") }] },
      ...Array.from({ length: MAX_TOOL_OUTPUT_IMAGES + 1 }, (_, i) => turn(`c${i}`, img(`T${i}`))).flat(),
    ];
    const out = R2O({ input });
    expect(urls(out)).toContain(img("USER"));
    expect(urls(out)).not.toContain(img("T0"));
    expect(notes(out)).toHaveLength(1);
  });
});

describe("#1073 capability policy for tool-output images", () => {
  const body = () => ({ input: [...turn("c1", img("AAAA")), { type: "message", role: "user", content: [{ type: "input_text", text: "go" }] }] });

  it("strips tool-output images for a non-vision model and keeps tool text", () => {
    const b = body();
    expect(stripUnsupportedModalities(b, FORMATS.OPENAI_RESPONSES, { vision: false })).toBe(true);
    const out = R2O(b);
    expect(urls(out)).toEqual([]);
    const tool = out.messages.find((m) => m.role === "tool");
    expect(tool.content).toContain("out-c1");
    expect(tool.content).toContain("[Previous image omitted from context.]");
  });

  it("keeps tool-output images for a vision-capable model", () => {
    const b = body();
    stripUnsupportedModalities(b, FORMATS.OPENAI_RESPONSES, { vision: true, pdf: false });
    expect(urls(R2O(b))).toEqual([img("AAAA")]);
  });
});
