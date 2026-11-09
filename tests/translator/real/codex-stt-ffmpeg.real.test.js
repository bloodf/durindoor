// Real local ffmpeg conversion for Codex STT (#1563). No provider call is made.
//   RUN_REAL=1 npx vitest run --config tests/vitest.config.js tests/translator/real/codex-stt-ffmpeg.real.test.js
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { convertAudio } from "../../../open-sse/handlers/codexSttAudio.js";

const RUN_REAL = process.env.RUN_REAL === "1";

describe.skipIf(!RUN_REAL)("codex stt ffmpeg conversion (real ffmpeg)", () => {
  it("converts a generated tone to mono 24 kHz PCM16 WAV", async () => {
    const tone = execFileSync("ffmpeg", ["-nostdin", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-f", "wav", "pipe:1"], { maxBuffer: 1 << 24 });
    const { audio, seconds } = await convertAudio(new Blob([tone]), new AbortController().signal);
    const wav = Buffer.from(await audio.arrayBuffer());
    expect(wav.subarray(0, 4).toString()).toBe("RIFF");
    expect(wav.readUInt32LE(24)).toBe(24000);
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(seconds).toBeCloseTo(1, 1);
  });
});
