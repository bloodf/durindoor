import { describe, expect, it } from "vitest";
import { getPxpipeStatusTone, getPxpipeStatusView, fetchPxpipeStatus } from "../../src/app/(dashboard)/dashboard/pxpipe/pxpipeStatus.js";

describe("PXPIPE status view", () => {
  it("keeps an API failure distinct from a missing dependency", () => {
    expect(getPxpipeStatusView(
      { error: "Local only: CLI token required", loading: false },
      { healthy: false, error: "Local only: CLI token required" },
    )).toEqual({
      label: "Unavailable",
      dependencyMissing: false,
      error: "Local only: CLI token required",
    });
  });

  it("shows repair guidance only for an explicit missing dependency", () => {
    expect(getPxpipeStatusView(
      { installed: false, loading: false },
      null,
    )).toEqual({
      label: "Not installed",
      dependencyMissing: true,
      error: null,
    });
  });

  it("classifies unrecognized/empty status as Unavailable, never Not installed", () => {
    expect(getPxpipeStatusView({}, null)).toEqual({
      label: "Unavailable",
      dependencyMissing: false,
      error: null,
    });
  });

  it("treats a null status as Unavailable without crashing or marking dependency missing", () => {
    expect(getPxpipeStatusView(null, null)).toEqual({
      label: "Unavailable",
      dependencyMissing: false,
      error: null,
    });
  });

  it.each([
    [{ loading: true }, null, "Checking…"],
    [{ installing: true }, null, "Installing…"],
    [{ installed: true, running: true }, { healthy: true }, "Healthy"],
    [{ installed: true, running: true }, { healthy: false }, "Running"],
    [{ installed: true, running: false }, { healthy: false }, "Stopped"],
  ])("classifies the supplied state", (status, health, label) => {
    expect(getPxpipeStatusView(status, health).label).toBe(label);
  });
});

describe("getPxpipeStatusTone", () => {
  it("prioritizes a status error over a healthy health check", () => {
    expect(getPxpipeStatusTone(
      { error: "Local only: CLI token required", loading: false },
      { healthy: true },
    )).toBe("text-warning");
  });

  it("returns success when healthy with no error", () => {
    expect(getPxpipeStatusTone({ installed: true, running: true }, { healthy: true })).toBe("text-success");
  });

  it("returns muted when neither error nor healthy", () => {
    expect(getPxpipeStatusTone({}, null)).toBe("text-text-muted");
  });

  it("returns muted for a null initial status", () => {
    expect(getPxpipeStatusTone(null, null)).toBe("text-text-muted");
  });
});

describe("fetchPxpipeStatus", () => {
  it("keeps successful status fields", async () => {
    const fetchImpl = async (url, options) => {
      expect(url).toBe("/api/pxpipe/status");
      expect(options).toEqual({ headers: { "Cache-Control": "no-store" } });
      return { ok: true, json: async () => ({ installed: true, running: true, version: "1.2.3" }) };
    };

    await expect(fetchPxpipeStatus(fetchImpl)).resolves.toEqual({
      installed: true,
      running: true,
      version: "1.2.3",
      error: null,
      loading: false,
    });
  });

  it("maps a non-2xx diagnostic to unavailable state", async () => {
    const result = await fetchPxpipeStatus(async () => ({
      ok: false,
      status: 403,
      json: async () => ({ error: "CLI token required" }),
    }));

    expect(result).toEqual({ error: "CLI token required", loading: false });
    expect(getPxpipeStatusView(result)).toMatchObject({
      label: "Unavailable",
      dependencyMissing: false,
    });
  });

  it("maps a network error to unavailable state", async () => {
    const result = await fetchPxpipeStatus(async () => {
      throw new Error("network down");
    });

    expect(result).toEqual({ error: "network down", loading: false });
    expect(getPxpipeStatusView(result)).toMatchObject({
      label: "Unavailable",
      dependencyMissing: false,
    });
  });

  it("maps malformed successful JSON to unavailable state", async () => {
    await expect(fetchPxpipeStatus(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token");
      },
    }))).resolves.toEqual({
      error: "PXPIPE status returned invalid JSON",
      loading: false,
    });
  });
});
