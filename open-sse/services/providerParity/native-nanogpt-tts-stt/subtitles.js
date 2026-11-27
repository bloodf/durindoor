// Subtitle transcripts from NanoGPT transcription (#2034): `srt` and `vtt`,
// which NanoGPT's audio model catalog lists for whisper-1
// (GET https://nano-gpt.com/api/v1/audio-models?type=stt, `whisper-1`
// supported_parameters.response_formats, feature "Subtitle format support (SRT,
// VTT)"). The pinned OmniRoute source forwards any response_format and passes
// the answer through (open-sse/handlers/audioTranscription.ts default branch).
//
// The checks are syntax only: SubRip cues (`n`, `HH:MM:SS,mmm --> HH:MM:SS,mmm`,
// text) and WebVTT (a `WEBVTT` header, optional NOTE/STYLE/REGION blocks, cues
// with an optional identifier and `[HH:]MM:SS.mmm --> [HH:]MM:SS.mmm [settings]`).
// A cue may not end before it starts. Silence may give no cues.

/** Answer media types (lower-cased, no parameters) that can carry each subtitle format. */
const SUBTITLE_TYPES = Object.freeze({
  srt: new Set(["", "text/plain", "application/x-subrip", "text/srt"]),
  vtt: new Set(["", "text/plain", "text/vtt"]),
});
/** The media type each subtitle format is returned with. */
export const NANOGPT_SUBTITLE_CONTENT_TYPES = Object.freeze({ srt: "application/x-subrip; charset=utf-8", vtt: "text/vtt; charset=utf-8" });
export const NANOGPT_SUBTITLE_FORMATS = Object.freeze(["srt", "vtt"]);

const SRT_TIME = /^(\d{2,}):([0-5]\d):([0-5]\d),(\d{3})$/;
const VTT_TIME = /^(?:(\d{2,}):)?([0-5]\d):([0-5]\d)\.(\d{3})$/;

export const isSubtitleFormat = (format) => NANOGPT_SUBTITLE_FORMATS.includes(format);
export const subtitleTypeAllowed = (format, type) => SUBTITLE_TYPES[format]?.has(type) ?? false;

const millis = (match) => (Number(match[1] ?? 0) * 3600 + Number(match[2]) * 60 + Number(match[3])) * 1000 + Number(match[4]);

/** `start --> end` with both times matching `pattern`, start not after end. */
function timing(line, pattern, allowSettings) {
  const parts = line.trim().split(/[ \t]+/);
  if (parts.length < 3 || parts[1] !== "-->" || (!allowSettings && parts.length !== 3)) return false;
  const start = pattern.exec(parts[0]);
  const end = pattern.exec(parts[2]);
  return Boolean(start && end && millis(start) <= millis(end));
}

const blocksOf = (text) => text.replace(/\r\n?/g, "\n").split(/\n[ \t]*\n+/).map((block) => block.replace(/^\n+|\n+$/g, "")).filter((block) => block.trim());

function validSrt(text) {
  for (const block of blocksOf(text.replace(/^﻿/, ""))) {
    const lines = block.split("\n");
    if (lines.length < 2 || !/^\d+$/.test(lines[0].trim())) return false;
    if (!timing(lines[1], SRT_TIME, false)) return false;
  }
  return true;
}

function validVtt(text) {
  const blocks = blocksOf(text.replace(/^﻿/, ""));
  if (!blocks.length || !/^WEBVTT(?:[ \t][^\n]*)?$/.test(blocks[0].split("\n")[0])) return false;
  // Header block: only header lines, no cue timing.
  if (blocks[0].split("\n").some((line) => line.includes("-->"))) return false;
  for (const block of blocks.slice(1)) {
    const lines = block.split("\n");
    if (/^(NOTE|STYLE|REGION)(?:[ \t]|$)/.test(lines[0])) continue;
    const timingIndex = lines[0].includes("-->") ? 0 : 1;
    if (timingIndex === 1 && lines.length < 2) return false;
    if (!timing(lines[timingIndex], VTT_TIME, true)) return false;
  }
  return true;
}

/** Whether `text` is a syntactically valid `srt` or `vtt` document. */
export function validSubtitles(format, text) {
  if (format === "srt") return validSrt(text);
  if (format === "vtt") return validVtt(text);
  return false;
}
