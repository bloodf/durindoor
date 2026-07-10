import { describe, expect, it, vi } from "vitest";
import providers from "../../cli/src/cli/menus/providers.js";

const {
  supportsConnectionAutoPing,
  isConnectionAutoPingOn,
  buildConnectionHeader,
  toggleConnectionAutoPing,
} = providers.__test__;

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

    it("returns false for inactive OAuth connections", () => {
      expect(supportsConnectionAutoPing({ authType: "oauth", isActive: false }, "claude")).toBe(false);
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

  describe("toggleConnectionAutoPing", () => {
    function createDeps(settings, updateResult = { success: true, data: {} }) {
      return {
        api: {
          getSettings: vi.fn().mockResolvedValue(settings),
          updateConnectionAutoPing: vi.fn().mockResolvedValue(updateResult),
        },
        showStatus: vi.fn(),
        pause: vi.fn().mockResolvedValue(),
      };
    }

    it("refetches settings and disables a currently enabled Claude connection", async () => {
      const deps = createDeps({
        success: true,
        data: { claudeAutoPing: { connections: { "conn-1": true } } },
      });

      const result = await toggleConnectionAutoPing(
        { id: "conn-1", authType: "oauth" },
        "claude",
        { claudeAutoPing: { connections: { "conn-1": false } } },
        deps,
      );

      expect(deps.api.getSettings).toHaveBeenCalledOnce();
      expect(deps.api.updateConnectionAutoPing).toHaveBeenCalledWith("conn-1", false);
      expect(result).toMatchObject({ success: true, enabled: false });
    });

    it("enables a currently disabled Codex connection through the scoped endpoint", async () => {
      const deps = createDeps({ success: true, data: { codexAutoPing: { connections: {} } } });

      const result = await toggleConnectionAutoPing(
        { id: "codex-1", authType: "oauth" }, "codex", null, deps,
      );

      expect(deps.api.updateConnectionAutoPing).toHaveBeenCalledWith("codex-1", true);
      expect(result).toMatchObject({ success: true, enabled: true });
    });

    it("does not mutate settings when the click-time refresh fails", async () => {
      const deps = createDeps({ success: false, error: "offline" });

      const result = await toggleConnectionAutoPing(
        { id: "conn-1", authType: "oauth" }, "claude", null, deps,
      );

      expect(deps.api.updateConnectionAutoPing).not.toHaveBeenCalled();
      expect(deps.showStatus).toHaveBeenCalledWith("Failed to load settings: offline", "error");
      expect(result).toEqual({ success: false, error: "offline" });
    });

    it("reports a scoped update failure without a success message", async () => {
      const deps = createDeps(
        { success: true, data: { claudeAutoPing: { connections: {} } } },
        { success: false, error: "conflict" },
      );

      const result = await toggleConnectionAutoPing(
        { id: "conn-1", authType: "oauth" }, "claude", null, deps,
      );

      expect(deps.showStatus).toHaveBeenCalledWith("Failed to update auto-ping: conflict", "error");
      expect(deps.showStatus).not.toHaveBeenCalledWith(expect.stringContaining("enabled"), "success");
      expect(result).toEqual({ success: false, error: "conflict" });
    });

    it.each([
      ["gemini", { id: "conn-1", authType: "oauth" }],
      ["claude", { id: "conn-1", authType: "apikey" }],
      ["claude", { id: "conn-1", authType: "oauth", isActive: false }],
      ["claude", { authType: "oauth" }],
    ])("rejects an ineligible %s connection without API calls", async (providerId, connection) => {
      const deps = createDeps({ success: true, data: {} });

      const result = await toggleConnectionAutoPing(connection, providerId, null, deps);

      expect(deps.api.getSettings).not.toHaveBeenCalled();
      expect(deps.api.updateConnectionAutoPing).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
    });
  });
});
