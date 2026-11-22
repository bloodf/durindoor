import { afterEach, describe, expect, it, vi } from "vitest";
import { writeClipboard } from "../../src/shared/hooks/useCopyToClipboard.js";

afterEach(() => vi.unstubAllGlobals());

describe("clipboard fallback", () => {
  it("copies with the legacy API when the clipboard API rejects", async () => {
    const textarea = { style: {}, select: vi.fn(), remove: vi.fn() };
    const execCommand = vi.fn(() => true);
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    vi.stubGlobal("document", { createElement: () => textarea, body: { appendChild: vi.fn() }, execCommand });

    await writeClipboard("hello");

    expect(textarea.value).toBe("hello");
    expect(textarea.select).toHaveBeenCalledOnce();
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(textarea.remove).toHaveBeenCalledOnce();
  });
});
