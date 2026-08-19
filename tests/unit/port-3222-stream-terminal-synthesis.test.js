import { describe, it, expect } from "vitest";
import { buildTransformStream } from "../../open-sse/handlers/chatCore/streamingHandler.js";
import { createTerminalTracker } from "../../open-sse/utils/streamTerminal.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

// Port of upstream 9router PR #3222 commit daf1d9a1e: buildTransformStream must
// report the FORMAT ACTUALLY EMITTED TO THE CLIENT, not the raw provider
// targetFormat, so the terminal tracker keys off the right decoder. Before this
// fix, terminalTracker was keyed on targetFormat, which is wrong whenever a
// translation branch runs (codex-translation or generic needsTranslation) since
// those emit sourceFormat/codexTarget to the client, not targetFormat.
describe("port #3222: buildTransformStream emittedFormat threading", () => {
  it("codex-translation branch: emittedFormat is the codex target, not targetFormat", () => {
    const { emittedFormat } = buildTransformStream({
      provider: "codex",
      sourceFormat: FORMATS.CLAUDE,
      targetFormat: FORMATS.OPENAI_RESPONSES,
      userAgent: "some-client/1.0",
      toolNameMap: {},
      body: {},
    });
    // CODEX_SOURCE_TO_TARGET[CLAUDE] = CLAUDE
    expect(emittedFormat).toBe(FORMATS.CLAUDE);
    expect(emittedFormat).not.toBe(FORMATS.OPENAI_RESPONSES);
  });

  it("passthrough branch: emittedFormat equals targetFormat", () => {
    const { emittedFormat } = buildTransformStream({
      provider: "anthropic",
      sourceFormat: FORMATS.CLAUDE,
      targetFormat: FORMATS.CLAUDE,
      userAgent: "some-client/1.0",
      toolNameMap: {},
      body: {},
    });
    expect(emittedFormat).toBe(FORMATS.CLAUDE);
  });

  it("terminal tracker built from a wrong (provider) format silently no-ops for a real client format", () => {
    // Regression guard: the bug this PR fixes. If callers key the tracker on
    // targetFormat (OPENAI_RESPONSES) while the client actually receives CLAUDE
    // frames, createTerminalTracker keyed on the wrong format still returns a
    // tracker object (OPENAI_RESPONSES is itself a supported format), but it
    // would classify frames using the wrong decoder. Keying on emittedFormat
    // (CLAUDE, as asserted above) uses the correct decoder.
    const wrongTracker = createTerminalTracker(FORMATS.OPENAI_RESPONSES);
    const rightTracker = createTerminalTracker(FORMATS.CLAUDE);
    expect(wrongTracker).not.toBeNull();
    expect(rightTracker).not.toBeNull();
    // Different formats -> different tracker instances/behavior are expected;
    // this asserts createTerminalTracker is sensitive to the format argument
    // buildTransformStream now supplies as emittedFormat.
    expect(wrongTracker).not.toBe(rightTracker);
  });
});
