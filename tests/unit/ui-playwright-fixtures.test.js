import { describe, expect, it } from "vitest";
import { isAllowedDestination, safeArtifactPath, parseProjectName, validatedQaHardDir } from "../e2e/boundaries.mjs";

describe("UI Playwright fixture safety boundaries", () => {
  it("only allows the isolated runtime origin and inert data:/about:blank schemes", () => {
    const baseURL = "http://127.0.0.1:43123";

    expect(isAllowedDestination(`${baseURL}/dashboard`, baseURL)).toBe(true);
    expect(isAllowedDestination("data:image/svg+xml,ok", baseURL)).toBe(true);
    expect(isAllowedDestination("about:blank", baseURL)).toBe(true);
    expect(isAllowedDestination("about:blank#fragment", baseURL)).toBe(false);
    expect(isAllowedDestination("javascript:alert(1)", baseURL)).toBe(false);
    expect(isAllowedDestination("blob:https://evil.example/id", baseURL)).toBe(false);
    expect(isAllowedDestination("https://example.com/collect", baseURL)).toBe(false);
    expect(isAllowedDestination("http://169.254.169.254/latest/meta-data", baseURL)).toBe(false);
  });

  it("rejects a forged origin that merely embeds or resembles the runtime origin", () => {
    const baseURL = "http://127.0.0.1:43123";

    // Same host, different port — a distinct origin.
    expect(isAllowedDestination("http://127.0.0.1:9999/", baseURL)).toBe(false);
    // Same origin string stuffed into the path/userinfo of a different host.
    expect(isAllowedDestination("http://127.0.0.1:43123.evil.example/", baseURL)).toBe(false);
    expect(isAllowedDestination(`http://evil.example/${baseURL}`, baseURL)).toBe(false);
    expect(isAllowedDestination(`http://127.0.0.1:43123@evil.example/`, baseURL)).toBe(false);
    // https vs http on the same host:port is a different origin.
    expect(isAllowedDestination("https://127.0.0.1:43123/", baseURL)).toBe(false);
  });

  it("rejects malformed and non-string URL inputs without throwing", () => {
    const baseURL = "http://127.0.0.1:43123";

    expect(isAllowedDestination("", baseURL)).toBe(false);
    expect(isAllowedDestination("not a url", baseURL)).toBe(false);
    expect(isAllowedDestination(null, baseURL)).toBe(false);
    expect(isAllowedDestination(undefined, baseURL)).toBe(false);
    expect(isAllowedDestination("http://127.0.0.1:43123/path", "")).toBe(false);
    expect(isAllowedDestination("http://127.0.0.1:43123/path", ":::not a url:::")).toBe(false);
  });

  it("keeps requested artifacts within the runtime-owned artifact directory", () => {
    const root = "/tmp/durindoor-qa/artifacts";

    expect(safeArtifactPath(root, "failure.png")).toBe(`${root}/failure.png`);
    expect(() => safeArtifactPath(root, "../storage-state.json")).toThrow(
      "artifactPath escapes artifactDir",
    );
    expect(() => safeArtifactPath(root, "/etc/passwd")).toThrow(
      "artifactPath escapes artifactDir",
    );
    expect(() => safeArtifactPath(123, "x")).toThrow(/requires string/);
  });

  it("rejects percent-encoded traversal segments the same as literal ones", () => {
    const root = "/tmp/durindoor-qa/artifacts";

    // path.resolve does not decode `%2e%2e`, so it is treated as a literal
    // filename segment and stays contained — the guard must not be fooled
    // into thinking an encoded `..` reaches outside artifactDir either way.
    expect(safeArtifactPath(root, "%2e%2e/storage-state.json")).toBe(
      `${root}/%2e%2e/storage-state.json`,
    );
    expect(() => safeArtifactPath(root, "../../etc/passwd")).toThrow(
      "artifactPath escapes artifactDir",
    );
    expect(() => safeArtifactPath(root, "sub/../../escape.png")).toThrow(
      "artifactPath escapes artifactDir",
    );
  });

  it("accepts only a child invocation root under qa/runs", () => {
    const root = "/workspace/durindoor";

    expect(validatedQaHardDir(root, "/workspace/durindoor/qa/runs/invocation-a1b2")).toBe(
      "/workspace/durindoor/qa/runs/invocation-a1b2",
    );
    expect(() => validatedQaHardDir(root, undefined)).toThrow("DURIN_QA_HARD_DIR must name");
    expect(() => validatedQaHardDir(root, "/workspace/durindoor/qa/runs")).toThrow("must be contained");
    expect(() => validatedQaHardDir(root, "/workspace/durindoor/qa/runs/../escape")).toThrow("must be contained");
    expect(() => validatedQaHardDir(root, "qa/runs/invocation-a1b2")).toThrow("must be an absolute path");
    expect(() => validatedQaHardDir(root, "/tmp/invocation-a1b2")).toThrow("must be contained");
  });

  it("parses canonical project names and tolerates non-canonical ones", () => {
    expect(parseProjectName("chromium-dark-mobile")).toEqual({
      id: "chromium-dark-mobile",
      browser: "chromium",
      theme: "dark",
      viewport: "mobile",
    });
    expect(parseProjectName("firefox-light-desktop")).toEqual({
      id: "firefox-light-desktop",
      browser: "firefox",
      theme: "light",
      viewport: "desktop",
    });
    expect(parseProjectName("webkit-dark-desktop")).toEqual({
      id: "webkit-dark-desktop",
      browser: "webkit",
      theme: "dark",
      viewport: "desktop",
    });
    expect(parseProjectName("not-a-real-project")).toEqual({
      id: "not-a-real-project",
      browser: "unknown",
      theme: "unknown",
      viewport: "unknown",
    });
    // Well-formed shape, but an unrecognized value in one field — the whole
    // result must fall back to unknown rather than mixing valid/invalid.
    expect(parseProjectName("chromium-dark-tablet")).toEqual({
      id: "chromium-dark-tablet",
      browser: "unknown",
      theme: "unknown",
      viewport: "unknown",
    });
    expect(parseProjectName("")).toEqual({
      id: "unknown",
      browser: "unknown",
      theme: "unknown",
      viewport: "unknown",
    });
  });
});
