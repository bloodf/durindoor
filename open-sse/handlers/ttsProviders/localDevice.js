// Local device TTS — macOS `say` + Windows SAPI + ffmpeg
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isString } from "../../../src/shared/utils/typeChecks.js";

const execFileAsync = promisify(execFile);

let _voicesCache = null;

async function fetchVoicesMac() {
  const { stdout } = await execFileAsync("say", ["-v", "?"]);
  const voices = [];
  for (const line of stdout.split("\n")) {
    const m = line.match(/^([^\s].*?)\s{2,}([a-z]{2}_[A-Z]{2})/);
    if (!m) continue;
    const name = m[1].trim();
    const locale = m[2].trim();
    const lang = locale.split("_")[0];
    const country = locale.split("_")[1];
    voices.push({ id: name, name, locale, lang, country, gender: "" });
  }
  return voices;
}

async function fetchVoicesWin() {
  const script = [
    "Add-Type -AssemblyName System.Speech;",
    "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer;",
    "$s.GetInstalledVoices() | ForEach-Object { $v = $_.VoiceInfo;",
    "[PSCustomObject]@{ Name=$v.Name; Culture=$v.Culture.Name; Gender=$v.Gender } }",
    "| ConvertTo-Json -Compress",
  ].join(" ");
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script],
    { windowsHide: true }
  );
  const raw = JSON.parse(stdout.trim() || "[]");
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map((v) => {
    const culture = v.Culture || "en-US";
    const [lang, country = ""] = culture.split("-");
    const genderMap = { 1: "Male", 2: "Female", Male: "Male", Female: "Female" };
    return {
      id: v.Name, name: v.Name,
      locale: culture.replace("-", "_"),
      lang, country,
      gender: genderMap[v.Gender] || "",
    };
  });
}

export async function fetchLocalDeviceVoices() {
  if (_voicesCache) return _voicesCache;
  try {
    const voices = process.platform === "win32" ? await fetchVoicesWin() : await fetchVoicesMac();
    _voicesCache = voices;
    return voices;
  } catch {
    return [];
  }
}

/**
 * Reject option-like voice ids and, when a voice list is available, require a
 * known id. Empty / non-string voiceId means the system default voice.
 *
 * @param {unknown} voiceId
 * @param {Array<{ id?: string }>|null|undefined} voices
 * @returns {{ ok: true, voiceId: string|null } | { ok: false, error: string }}
 */
export function resolveLocalDeviceVoice(voiceId, voices) {
  if (!isString(voiceId) || !voiceId.trim()) {
    return { ok: true, voiceId: null };
  }
  const requested = voiceId.trim();
  if (requested.startsWith("-")) {
    return { ok: false, error: `Invalid local-device voice "${requested}": voice must not start with "-".` };
  }
  if (Array.isArray(voices) && voices.length > 0) {
    const known = new Set(voices.map((v) => v?.id).filter(Boolean));
    if (!known.has(requested)) {
      return { ok: false, error: `Unknown local-device voice "${requested}".` };
    }
  }
  return { ok: true, voiceId: requested };
}

/**
 * Build `say` argv with an end-of-options marker so client text cannot inject
 * flags such as `-f` (read a server-side file).
 *
 * @param {string} aiffPath
 * @param {string} text
 * @param {string|null|undefined} voiceId
 * @returns {string[]}
 */
export function buildSayArgs(aiffPath, text, voiceId) {
  if (voiceId) {
    return ["-v", voiceId, "-o", aiffPath, "--", text];
  }
  return ["-o", aiffPath, "--", text];
}

async function synthesizeMacOrWin(text, voiceId) {
  const voices = await fetchLocalDeviceVoices();
  const resolved = resolveLocalDeviceVoice(voiceId, voices);
  if (!resolved.ok) {
    const err = new Error(resolved.error);
    err.status = 400;
    throw err;
  }
  const dir = await mkdtemp(join(tmpdir(), "tts-"));
  const aiffPath = join(dir, "out.aiff");
  const mp3Path = join(dir, "out.mp3");
  try {
    const args = buildSayArgs(aiffPath, text, resolved.voiceId);
    await execFileAsync("say", args);
    await execFileAsync("ffmpeg", ["-y", "-i", aiffPath, "-codec:a", "libmp3lame", "-qscale:a", "4", mp3Path]);
    const buf = await readFile(mp3Path);
    return buf.toString("base64");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export default {
  noAuth: true,
  async synthesize(text, model) {
    const base64 = await synthesizeMacOrWin(text, model);
    return { base64, format: "mp3" };
  },
};
