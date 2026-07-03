// Tool-pairing invariant self-check (OpenAI intermediate format).
// Run: node open-sse/utils/toolPairingSelfCheck.mjs
// No framework, no deps. Uses assert. Mirrors openaiResponsesToolPairingSelfCheck.mjs style.
import { stripOrphanedToolResults } from "../translator/concerns/toolCall.js";

// stripOrphanedToolResults returns a count and mutates in place; wrap so
// the self-check assertions below can keep reading from the returned body.
const strip = (body) => { stripOrphanedToolResults(body); return body; };

const results = [];
function run(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, err: err.message });
  }
}
const assert = {
  equal(a, b, msg) { if (a !== b) throw new Error(`${msg || ""} expected ${b}, got ${a}`); },
  ok(v, msg) { if (!v) throw new Error(msg || "expected truthy"); },
};

// 1. Matched OpenAI tool_calls + role:tool preserved
run("OpenAI matched tool result preserved", () => {
  const body = {
    messages: [
      { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "foo", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "call_1", content: "result" },
      { role: "user", content: "next" }
    ]
  };
  const out = strip(body);
  assert.equal(out.messages.length, 3, "message count");
  assert.equal(out.messages[1].tool_call_id, "call_1", "tool result preserved");
});

// 2. Orphan OpenAI role:tool stripped
run("OpenAI orphan tool result stripped", () => {
  const body = {
    messages: [
      { role: "user", content: "hi" },
      { role: "tool", tool_call_id: "call_ghost", content: "stale" },
      { role: "user", content: "next" }
    ]
  };
  const out = strip(body);
  assert.equal(out.messages.length, 2, "orphan tool stripped");
  assert.ok(!out.messages.some(m => m.role === "tool"), "no tool messages remain");
});

// 3. Zero-call truncation strips all stale tool results
run("Zero-call truncation strips all stale tool results", () => {
  const body = {
    messages: [
      { role: "tool", tool_call_id: "call_a", content: "x" },
      { role: "tool", tool_call_id: "call_b", content: "y" },
      { role: "user", content: "next" }
    ]
  };
  const out = strip(body);
  assert.equal(out.messages.length, 1, "all orphan tools stripped");
  assert.equal(out.messages[0].role, "user", "user message preserved");
});

// 4. Claude-shaped tool_use + tool_result preserved
run("Claude-shaped matched tool_result preserved", () => {
  const body = {
    messages: [
      { role: "assistant", content: [{ type: "tool_use", id: "tu_1", name: "bar", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "tu_1", content: "ok" }] },
      { role: "user", content: [{ type: "text", text: "next" }] }
    ]
  };
  const out = strip(body);
  assert.equal(out.messages.length, 3, "claude matched preserved");
  assert.equal(out.messages[1].content[0].tool_use_id, "tu_1", "claude tool_result preserved");
});

// 5. Orphan Claude-shaped tool_result stripped while text remains
run("Claude-shaped orphan tool_result stripped from mixed user content", () => {
  const body = {
    messages: [
      { role: "user", content: [
        { type: "text", text: "keep me" },
        { type: "tool_result", tool_use_id: "tu_ghost", content: "stale" }
      ] },
      { role: "user", content: [{ type: "text", text: "next" }] }
    ]
  };
  const out = strip(body);
  assert.equal(out.messages.length, 2, "mixed user message kept");
  assert.equal(out.messages[0].content.length, 1, "orphan block stripped");
  assert.equal(out.messages[0].content[0].text, "keep me", "text block preserved");
});

// 6. User message with only orphan tool_result blocks is dropped entirely
run("User message with only orphan tool_result blocks dropped", () => {
  const body = {
    messages: [
      { role: "user", content: [{ type: "tool_result", tool_use_id: "tu_ghost", content: "stale" }] },
      { role: "user", content: [{ type: "text", text: "next" }] }
    ]
  };
  // Override: the first message has ONLY an orphan tool_result block.
  // After strip, its content array becomes empty → drop the message.
  body.messages[0].content = [{ type: "tool_result", tool_use_id: "tu_ghost2", content: "stale2" }];
  const out = strip(body);
  assert.equal(out.messages.length, 1, "empty user message dropped");
  assert.equal(out.messages[0].content[0].text, "next", "next user message preserved");
});

// 7. No-op body keeps same messages array reference
run("No-op keeps same body when no orphans", () => {
  const body = {
    messages: [
      { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "foo", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "call_1", content: "result" }
    ]
  };
  const out = strip(body);
  assert.equal(out, body, "same body reference returned on no-op");
});

// 8. Mixed: one matched, one orphan
run("Mixed: matched kept, orphan stripped", () => {
  const body = {
    messages: [
      { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "foo", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "call_1", content: "matched" },
      { role: "tool", tool_call_id: "call_orphan", content: "stale" },
      { role: "user", content: "next" }
    ]
  };
  const out = strip(body);
  assert.equal(out.messages.length, 3, "orphan stripped, matched kept");
  assert.ok(out.messages.some(m => m.role === "tool" && m.tool_call_id === "call_1"), "matched tool kept");
  assert.ok(!out.messages.some(m => m.role === "tool" && m.tool_call_id === "call_orphan"), "orphan tool stripped");
});

// Summary
const passed = results.filter(r => r.ok).length;
const total = results.length;
for (const r of results) {
  console.log(`${r.ok ? "ok" : "FAIL"} - ${r.name}${r.ok ? "" : ` :: ${r.err}`}`);
}
console.log(`\n${passed}/${total} checks passed`);
if (passed !== total) process.exit(1);
