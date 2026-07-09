import { describe, expect, it } from "vitest";
import providers from "../../cli/src/cli/menus/providers.js";

const { supportsConnectionAutoPing, isConnectionAutoPingOn, buildConnectionHeader } = providers.__test__;

describe("cli providers auto-ping helpers", () => {
  describe("supportsConnectionAutoPing", () => {
    it("returns true for Claude OAuth connections", () => {
      expect(supportsConnectionAutoPing({ authType: "oauth" }, "claude")).toBe(true);
    });

    it("returns true for Codex OAuth connections", () => {
      expect(supportsConnectionAutoPing({ authType: "oauth" }, "codex")).toBe(true);
    });

    it("returns false for Claude API-key connections", () => {
      expect(supportsConnectionAutoPing({ authType: "apikey" }, "claude")).toBe(false);
    });

    it("returns false for unsupported providers", () => {
      expect(supportsConnectionAutoPing({ authType: "oauth" }, "gemini")).toBe(false);
      expect(supportsConnectionAutoPing({ authType: "oauth" }, "openai")).toBe(false);
    });
  });

  describe("isConnectionAutoPingOn", () => {
    it("returns true when the connection is enabled in settings", () => {
      const settings = { claudeAutoPing: { connections: { "conn-1": true } } };
      expect(isConnectionAutoPingOn(settings, "claude", "conn-1")).toBe(true);
    });

    it("returns false when the connection is disabled", () => {
      const settings = { claudeAutoPing: { connections: { "conn-1": false } } };
      expect(isConnectionAutoPingOn(settings, "claude", "conn-1")).toBe(false);
    });

    it("returns false when the connection is absent", () => {
      const settings = { claudeAutoPing: { connections: {} } };
      expect(isConnectionAutoPingOn(settings, "claude", "conn-1")).toBe(false);
    });

    it("returns false when the whole setting is absent", () => {
      expect(isConnectionAutoPingOn({}, "claude", "conn-1")).toBe(false);
    });
  });

  describe("buildConnectionHeader", () => {
    const claudeConn = { id: "conn-1", authType: "oauth" };

    it("shows Auto-ping ON when enabled", () => {
      const header = buildConnectionHeader("Work", "✓ Active", "claude", claudeConn, {
        settings: { claudeAutoPing: { connections: { "conn-1": true } } },
      });
      expect(header).toContain("Auto-ping: ON");
      expect(header).toContain("sends a tiny request when the 5h quota resets");
    });

    it("shows Auto-ping OFF when disabled", () => {
      const header = buildConnectionHeader("Work", "✓ Active", "claude", claudeConn, {
        settings: { claudeAutoPing: { connections: { "conn-1": false } } },
      });
      expect(header).toContain("Auto-ping: OFF");
    });

    it("shows unknown when settings failed to load", () => {
      const header = buildConnectionHeader("Work", "✓ Active", "claude", claudeConn, {
        settingsError: "network timeout",
      });
      expect(header).toContain("Auto-ping:");
      expect(header).toContain("unknown (network timeout)");
    });

    it("omits Auto-ping for unsupported providers", () => {
      const header = buildConnectionHeader("Work", "✓ Active", "gemini", { authType: "oauth" }, {
        settings: { claudeAutoPing: { connections: {} } },
      });
      expect(header).not.toContain("Auto-ping");
    });

    it("omits Auto-ping for non-OAuth connections", () => {
      const header = buildConnectionHeader("Work", "✓ Active", "claude", { authType: "apikey" }, {
        settings: { claudeAutoPing: { connections: {} } },
      });
      expect(header).not.toContain("Auto-ping");
    });
  });
});
