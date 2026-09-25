import { describe, expect, it } from "vitest";
import { GrokCliExecutor } from "../../open-sse/executors/grok-cli.js";

// Upstream OmniRoute#14615: Codex CLI replays Grok's reasoning items with
// `"content": null`. Grok Build then rejects the whole turn even though the
// `encrypted_content` is byte-identical to what it streamed:
//   400 Could not decode the compaction blob. Ensure it is unmodified from the
//   compact response.
// The same item without the `content` key is accepted. transformRequest() must
// drop a null `content` from reasoning items and leave the encrypted blob untouched.
const GROK_ID = "rs_d50f4f10-bb85-4c1e-9a53-0e6f2d1c7b21";
const ENCRYPTED = "U16FEQIOxM-opaque-grok-blob";

function transform(input) {
  const executor = new GrokCliExecutor();
  return executor.transformRequest("grok-build", { model: "grok-build", input, store: false }, true, {});
}

describe("grok-cli reasoning null content (omniroute-14615)", () => {
  it("drops null content from a replayed reasoning item, leaves the encrypted blob untouched", () => {
    const out = transform([
      { type: "message", role: "user", content: "hi" },
      { type: "reasoning", id: GROK_ID, summary: [], content: null, encrypted_content: ENCRYPTED },
    ]);

    // stripStoredItemReferences also removes the rs_-prefixed id later in transformRequest.
    expect(out.input[1]).toEqual({ type: "reasoning", summary: [], encrypted_content: ENCRYPTED });
  });

  it("drops null content from Grok's id-less tco_ tool reasoning", () => {
    const out = transform([{ type: "reasoning", summary: [], content: null, encrypted_content: "tco_7b-a" }]);

    expect(out.input[0]).toEqual({ type: "reasoning", summary: [], encrypted_content: "tco_7b-a" });
  });

  it("keeps reasoning content that is present", () => {
    const reasoning = {
      type: "reasoning",
      summary: [],
      content: [{ type: "reasoning_text", text: "step" }],
      encrypted_content: "tco_7b-a",
    };

    const out = transform([reasoning]);

    expect(out.input[0]).toEqual(reasoning);
  });

  it("leaves null content on non-reasoning items alone", () => {
    const message = { type: "message", role: "assistant", content: null };

    const out = transform([message]);

    expect(out.input[0]).toEqual(message);
  });
});
