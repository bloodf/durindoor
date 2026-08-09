import { describe, expect, it } from "vitest";

import { detectClientTool, isNativePassthrough } from "../../open-sse/utils/clientDetector.js";

describe("Codex client detection", () => {
  it.each([
    "codex-cli/0.144.1",
    "codex_cli_rs/0.144.1",
    "codex_exec/0.144.1 (Windows 11; x86_64)",
  ])("recognizes %s as native Codex", (userAgent) => {
    const client = detectClientTool({ "user-agent": userAgent });

    expect(client).toBe("codex");
    expect(isNativePassthrough(client, "codex")).toBe(true);
  });
});

describe("Codex Rust TUI and Codex Desktop detection (9router#cd13d904)", () => {
  it.each([
    "codex-tui/0.45.0",
    "Codex Desktop/0.1.0 (macOS)",
    "codex-tui/x86_64-unknown-linux-gnu",
  ])("recognizes %s as native Codex", (userAgent) => {
    const client = detectClientTool({ "user-agent": userAgent });
    expect(client).toBe("codex");
    expect(isNativePassthrough(client, "codex")).toBe(true);
  });

  it("recognizes Codex Desktop via originator codex_work_desktop", () => {
    const client = detectClientTool({ originator: "codex_work_desktop" });
    expect(client).toBe("codex");
  });

  it("recognizes codex_exec originator as native Codex", () => {
    const client = detectClientTool({ originator: "codex_exec/0.45.0" });
    expect(client).toBe("codex");
  });
});
