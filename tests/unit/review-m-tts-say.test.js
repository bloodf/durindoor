/**
 * #2222 — local-device TTS must not pass client text/voice to `say` as options.
 */
import { describe, expect, it } from "vitest";
import {
  buildSayArgs,
  resolveLocalDeviceVoice,
} from "../../open-sse/handlers/ttsProviders/localDevice.js";

describe("local-device say(1) option injection (#2222)", () => {
  it("puts -- before the spoken text so a leading -f cannot read a server file", () => {
    const args = buildSayArgs("/tmp/out.aiff", "-f /etc/passwd", "Alex");
    expect(args).toEqual(["-v", "Alex", "-o", "/tmp/out.aiff", "--", "-f /etc/passwd"]);
    const dashIdx = args.indexOf("--");
    expect(dashIdx).toBeGreaterThan(-1);
    expect(args[dashIdx + 1]).toBe("-f /etc/passwd");
  });

  it("still inserts -- when no voice is selected", () => {
    expect(buildSayArgs("/tmp/out.aiff", "hello", null)).toEqual([
      "-o", "/tmp/out.aiff", "--", "hello",
    ]);
  });

  it("rejects a voiceId that starts with -", () => {
    const result = resolveLocalDeviceVoice("-v", []);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/must not start with "-"/);
  });

  it("rejects an unknown voice when the known list is available", () => {
    const voices = [{ id: "Alex" }, { id: "Samantha" }];
    expect(resolveLocalDeviceVoice("Alex", voices)).toEqual({ ok: true, voiceId: "Alex" });
    const unknown = resolveLocalDeviceVoice("NotARealVoice", voices);
    expect(unknown.ok).toBe(false);
    expect(unknown.error).toMatch(/Unknown local-device voice/);
  });

  it("skips the allowlist when no voices are available, but still rejects leading -", () => {
    expect(resolveLocalDeviceVoice("Alex", [])).toEqual({ ok: true, voiceId: "Alex" });
    expect(resolveLocalDeviceVoice("Alex", null)).toEqual({ ok: true, voiceId: "Alex" });
    expect(resolveLocalDeviceVoice("-f", null).ok).toBe(false);
  });

  it("treats an empty voiceId as the system default", () => {
    expect(resolveLocalDeviceVoice("", [{ id: "Alex" }])).toEqual({ ok: true, voiceId: null });
    expect(resolveLocalDeviceVoice(null, [{ id: "Alex" }])).toEqual({ ok: true, voiceId: null });
  });
});
