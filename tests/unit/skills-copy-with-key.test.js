// @vitest-environment happy-dom
/**
 * The skills page copies an instruction an agent can act on: the skill URL plus
 * the selected base URL and, when chosen, a real API key.
 *
 * The security contract matters more than the convenience. `GET /api/keys`
 * deliberately returns masked management views (`sk-••••••••`); the raw
 * credential exists only behind `GET /api/keys/:id/reveal`. So the secret must
 * be fetched at copy time and written straight to the clipboard — never stored
 * in page state, never rendered.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildSkillInstruction,
  revealKeySecret,
} from "@/app/(dashboard)/dashboard/skills/useSkillTargets.js";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("buildSkillInstruction", () => {
  it("includes the skill URL and base URL", () => {
    const text = buildSkillInstruction({
      skillUrl: "https://example.test/SKILL.md",
      baseUrl: "http://localhost:20128/v1",
      apiKey: null,
    });
    expect(text).toContain("Read this skill and use it: https://example.test/SKILL.md");
    expect(text).toContain("Base URL: http://localhost:20128/v1");
  });

  it("omits the API key line entirely when no key is selected", () => {
    const text = buildSkillInstruction({
      skillUrl: "https://example.test/SKILL.md",
      baseUrl: "http://localhost:20128/v1",
      apiKey: null,
    });
    // A keyless endpoint must not receive a dangling "API key:" label.
    expect(text).not.toMatch(/API key/);
  });

  it("includes the resolved secret when a key is selected", () => {
    const text = buildSkillInstruction({
      skillUrl: "https://example.test/SKILL.md",
      baseUrl: "https://tunnel.test/v1",
      apiKey: "sk-real-secret-value",
    });
    expect(text).toContain("API key: sk-real-secret-value");
  });
});

describe("revealKeySecret", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it("reads the secret from the dedicated reveal route", async () => {
    global.fetch.mockResolvedValue(
      new Response(JSON.stringify({ key: "sk-revealed" }), { status: 200 }),
    );

    await expect(revealKeySecret("key-1")).resolves.toBe("sk-revealed");
    // The list route must not be used for secrets.
    expect(global.fetch.mock.calls[0][0]).toBe("/api/keys/key-1/reveal");
  });

  it("returns null without a request when no key is selected", async () => {
    await expect(revealKeySecret(null)).resolves.toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns null when the reveal is refused rather than copying a broken value", async () => {
    global.fetch.mockResolvedValue(
      new Response(JSON.stringify({ error: "Key not found" }), { status: 404 }),
    );
    await expect(revealKeySecret("missing")).resolves.toBeNull();
  });

  it("returns null when the reveal request throws", async () => {
    global.fetch.mockRejectedValue(new Error("offline"));
    await expect(revealKeySecret("key-1")).resolves.toBeNull();
  });
});
