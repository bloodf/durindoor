import { describe, expect, it } from "vitest";
import { GrokCliExecutor } from "../../open-sse/executors/grok-cli.js";

// Upstream OmniRoute#14650: in a combo where grok-cli is followed by another
// Responses provider (e.g. codex), one fallback turn makes every later turn fail
// on grok-cli. Codex CLI/desktop run with `store: false` and replay every prior
// `reasoning` item with its `encrypted_content`. After a turn served by codex,
// that blob is encrypted by OpenAI and Grok Build cannot decrypt it:
//   400 Could not decrypt the provided encrypted_content. Ensure the value is the
//   unmodified encrypted_content from a previous response.
// transformRequest() must drop `encrypted_content` from a reasoning item Grok Build
// did not produce, while keeping the item itself (with an empty summary when it
// has none). Grok Build's own reasoning ids look like `rs_<uuid>`, and its
// server-side tool reasoning (after a web search) is `tco_...` with an id and blob
// that both start with `tco_`.
const OPENAI_ID = "rs_0ace61e8ac94df2a016ab3bddd086487d0b29ca58423f85d49";
const GROK_ID = "rs_d50f4f10-bb85-4c1e-9a53-0e6f2d1c7b21";

function transformInput(input) {
  const executor = new GrokCliExecutor();
  const out = executor.transformRequest("grok-build", { model: "grok-build", input, store: false }, true, {});
  return out.input;
}

describe("grok-cli foreign reasoning replay (omniroute-14650)", () => {
  it("drops encrypted_content from reasoning another provider produced and adds the empty summary Grok accepts", () => {
    const out = transformInput([{ type: "reasoning", id: OPENAI_ID, encrypted_content: "gAAAAABo-openai" }]);

    // stripStoredItemReferences also removes the rs_-prefixed id later in transformRequest.
    expect(out).toEqual([{ type: "reasoning", summary: [] }]);
  });

  it("keeps Grok Build's own encrypted reasoning next to a foreign item", () => {
    const out = transformInput([
      { type: "reasoning", id: GROK_ID, encrypted_content: "U16FEQIOxM-grok" },
      { type: "reasoning", id: OPENAI_ID, encrypted_content: "gAAAAABo-openai" },
    ]);

    expect(out).toEqual([
      { type: "reasoning", encrypted_content: "U16FEQIOxM-grok" },
      { type: "reasoning", summary: [] },
    ]);
  });

  it("keeps Grok Build's own tco_ tool reasoning blob, with or without its id", () => {
    // After a server-side web search Grok emits `tco_...` reasoning whose blob starts
    // with `tco_` too; that id survives stripStoredItemReferences (it is not rs_/fc_/resp_/msg_).
    const out = transformInput([
      { type: "reasoning", id: "tco_7b1c2d3e-call-0", encrypted_content: "tco_7b-a" },
      { type: "reasoning", encrypted_content: "tco_7b-b" },
    ]);

    expect(out).toEqual([
      { type: "reasoning", id: "tco_7b1c2d3e-call-0", encrypted_content: "tco_7b-a" },
      { type: "reasoning", encrypted_content: "tco_7b-b" },
    ]);
  });

  it("leaves reasoning without an encrypted blob untouched", () => {
    const out = transformInput([
      { type: "reasoning", id: OPENAI_ID, summary: [{ type: "summary_text", text: "plan" }] },
      { type: "reasoning", content: [{ type: "reasoning_text", text: "plaintext" }], summary: [] },
    ]);

    expect(out).toEqual([
      { type: "reasoning", summary: [{ type: "summary_text", text: "plan" }] },
      { type: "reasoning", content: [{ type: "reasoning_text", text: "plaintext" }], summary: [] },
    ]);
  });
});
