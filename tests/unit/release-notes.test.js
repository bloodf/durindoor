/**
 * Unit tests for scripts/release-notes.mjs — version math, conventional-commit
 * bump derivation, changelog section building, and section extraction.
 */
import { describe, expect, it } from "vitest";
import {
  parseVersion,
  computeBump,
  nextVersion,
  classifySubject,
  buildChangelogSection,
  extractSection,
} from "../../scripts/release-notes.mjs";

describe("parseVersion", () => {
  it("parses plain and v-prefixed semver strings", () => {
    expect(parseVersion("4.0.0")).toEqual([4, 0, 0]);
    expect(parseVersion("v3.20.1")).toEqual([3, 20, 1]);
    expect(parseVersion(" 10.2.13\n")).toEqual([10, 2, 13]);
  });

  it("rejects non-semver input", () => {
    expect(() => parseVersion("4.0")).toThrow(/Not a semver/);
    expect(() => parseVersion("v4.0.0-beta")).toThrow(/Not a semver/);
    expect(() => parseVersion("banana")).toThrow(/Not a semver/);
    expect(() => parseVersion("")).toThrow(/Not a semver/);
  });
});

describe("computeBump", () => {
  it("returns patch when no feat or breaking marker is present", () => {
    expect(computeBump(["fix(ui): align toolbar", "docs: update readme", "ci: tweak gate"])).toBe("patch");
    expect(computeBump([])).toBe("patch");
  });

  it("returns minor when a feat subject is present", () => {
    expect(computeBump(["fix(ui): align toolbar", "feat(settings): add auto-clean"])).toBe("minor");
    expect(computeBump(["feat: something scopeless"])).toBe("minor");
  });

  it("returns major on any breaking-change marker", () => {
    expect(computeBump(["feat!: drop legacy dashboard"])).toBe("major");
    expect(computeBump(["fix(api)!: remove deprecated route"])).toBe("major");
    expect(computeBump(["port(upstream)!: #3626 reshape payload"])).toBe("major");
    // breaking beats feat regardless of order
    expect(computeBump(["feat: new thing", "chore!: change layout"])).toBe("major");
  });

  it("does not treat port/sync as features", () => {
    expect(computeBump(["port(upstream): #123 - fix edge case", "sync: vendor update"])).toBe("patch");
  });

  it("ignores non-conventional subjects for minor/major derivation", () => {
    expect(computeBump(["# v1.2.3 (2026-01-01)", "random merge text"])).toBe("patch");
  });
});

describe("nextVersion", () => {
  it("applies patch, minor, and major bumps", () => {
    expect(nextVersion("4.0.0", "patch")).toBe("4.0.1");
    expect(nextVersion("4.0.0", "minor")).toBe("4.1.0");
    expect(nextVersion("4.0.0", "major")).toBe("5.0.0");
    expect(nextVersion("v3.20.1", "minor")).toBe("3.21.0");
    expect(nextVersion("3.9.9", "patch")).toBe("3.9.10");
  });

  it("rejects unknown bumps and bad versions", () => {
    expect(() => nextVersion("4.0.0", "huge")).toThrow(/Unknown bump/);
    expect(() => nextVersion("nope", "patch")).toThrow(/Not a semver/);
  });
});

describe("classifySubject", () => {
  it("maps conventional types to changelog sections", () => {
    expect(classifySubject("feat(ui): new page")).toBe("Features");
    expect(classifySubject("feat: scopeless")).toBe("Features");
    expect(classifySubject("fix(headroom): stop 500s")).toBe("Fixes");
    expect(classifySubject("port(upstream): #3765 - guard ensureToolCallIds")).toBe("Upstream ports");
    expect(classifySubject("port(omniroute): quota groups")).toBe("Upstream ports");
    expect(classifySubject("sync: upstream v3.2.1")).toBe("Upstream ports");
    expect(classifySubject("chore(release): bump version to 4.0.0")).toBe("Maintenance");
    expect(classifySubject("ci: add workflow")).toBe("Maintenance");
    expect(classifySubject("test(gate): bound worker pool")).toBe("Maintenance");
    expect(classifySubject("docs: update readme")).toBe("Maintenance");
    expect(classifySubject("refactor(db): split helpers")).toBe("Maintenance");
  });

  it("classifies breaking markers by their underlying type", () => {
    expect(classifySubject("feat!: drop legacy ui")).toBe("Features");
    expect(classifySubject("fix(api)!: remove route")).toBe("Fixes");
    expect(classifySubject("chore!: config change")).toBe("Maintenance");
  });
});

describe("buildChangelogSection", () => {
  it("emits a version heading with grouped, non-empty subsections", () => {
    const section = buildChangelogSection("4.1.0", [
      "feat(settings): add auto-clean",
      "fix(ui): align toolbar",
      "port(upstream): #3765 - guard ensureToolCallIds",
      "ci: add release workflow",
      "chore(release): bump version to 4.1.0",
    ]);
    expect(section).toBe(
      [
        "# 4.1.0",
        "",
        "## Features",
        "",
        "- feat(settings): add auto-clean",
        "",
        "## Fixes",
        "",
        "- fix(ui): align toolbar",
        "",
        "## Upstream ports",
        "",
        "- port(upstream): #3765 - guard ensureToolCallIds",
        "",
        "## Maintenance",
        "",
        "- ci: add release workflow",
        "- chore(release): bump version to 4.1.0",
        "",
      ].join("\n"),
    );
  });

  it("omits empty subsections", () => {
    const section = buildChangelogSection("4.0.1", ["fix(a): one", "fix(b): two"]);
    expect(section).toContain("## Fixes");
    expect(section).not.toContain("## Features");
    expect(section).not.toContain("## Upstream ports");
    expect(section).not.toContain("## Maintenance");
    expect(section).toContain("- fix(a): one\n- fix(b): two");
  });

  it("keeps the full original subject as the bullet text", () => {
    const subject = "port(upstream): #3772 - replace nested Claude `tool_result` base64 media with a bounded placeholder (open-sse/translator/request/claude-to-openai.js)";
    expect(buildChangelogSection("4.0.1", [subject])).toContain(`- ${subject}`);
  });
});

describe("extractSection", () => {
  const fixture = [
    "# 4.1.0",
    "",
    "## Features",
    "",
    "- feat(x): new thing",
    "",
    "# 4.0.0",
    "",
    "- feat(ui): only flat bullets here",
    "",
    "# 3.20.1",
    "",
    "- fix(headroom): dev mode fix",
    "",
  ].join("\n");

  it("extracts a section up to the next top-level heading", () => {
    expect(extractSection(fixture, "4.0.0")).toBe("# 4.0.0\n\n- feat(ui): only flat bullets here\n");
  });

  it("extracts a section containing ## subsections without cutting at them", () => {
    expect(extractSection(fixture, "4.1.0")).toBe("# 4.1.0\n\n## Features\n\n- feat(x): new thing\n");
  });

  it("extracts the final section through end-of-file", () => {
    expect(extractSection(fixture, "3.20.1")).toBe("# 3.20.1\n\n- fix(headroom): dev mode fix\n");
  });

  it("returns null when the version is absent", () => {
    expect(extractSection(fixture, "9.9.9")).toBeNull();
  });

  it("does not confuse a subsection or substring with the version heading", () => {
    const tricky = "# 4.0.0\n\n## Fixes\n\n- note about # 4.0.10\n\n# 4.0.10\n\n- fix: real\n";
    expect(extractSection(tricky, "4.0.10")).toBe("# 4.0.10\n\n- fix: real\n");
    expect(extractSection(tricky, "4.0.1")).toBeNull();
  });
});
