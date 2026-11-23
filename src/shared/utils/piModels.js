// Pi model entry capabilities for the `durindoor` provider in ~/.pi/agent/models.json.
//
// Port of upstream 9router 1ca076167e (src/shared/utils/piModels.js), trimmed to the
// server-side pieces DurinDoor's Pi route uses. Pi's schema: `input` is
// ("text" | "image")[], `reasoning` says whether the model thinks at all, and
// `thinkingLevelMap` maps a Pi thinking level to the provider value to send, with
// `null` marking that level unsupported. A null *map* is invalid and makes Pi
// reject the whole models.json, so a map is either an object or absent.

import { isBoolean, isRecord, isString } from "@/shared/utils/typeChecks";

export const PI_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
export const PI_INPUT_VALUES = ["text", "image"];

// DurinDoor spells "off" as "none"; every other level shares Pi's name.
const piLevelValue = (level) => (level === "off" ? "none" : level);

/**
 * DurinDoor's level set for a model, in Pi's vocabulary. Returns null when the list is
 * missing or holds a level Pi cannot express (zai's binary `thinking`, codex's `ultra`),
 * so the model keeps Pi's defaults and a hand-written map survives.
 */
export function levelsFromServer(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const levels = [];
  for (const value of raw) {
    if (!isString(value)) return null;
    const level = value === "none" ? "off" : value;
    if (!PI_THINKING_LEVELS.includes(level)) return null;
    levels.push(level);
  }
  return PI_THINKING_LEVELS.filter((level) => levels.includes(level));
}

/** A full thinkingLevelMap for a set of supported Pi levels. */
export const thinkingLevelMapFromLevels = (levels) =>
  Object.fromEntries(PI_THINKING_LEVELS.map((level) => [level, levels.includes(level) ? piLevelValue(level) : null]));

/** Pi accepts `input` only from PI_INPUT_VALUES; anything else is dropped. */
export function sanitizePiInput(input) {
  if (!Array.isArray(input)) return undefined;
  const values = [...new Set(input.filter((value) => PI_INPUT_VALUES.includes(value)))];
  return values.length > 0 ? values : undefined;
}

/** Keep known levels whose value is a provider string or `null` (unsupported). */
export function sanitizePiThinkingLevelMap(map) {
  if (!isRecord(map)) return undefined;
  const clean = {};
  for (const level of PI_THINKING_LEVELS) {
    const value = map[level];
    if (isString(value) || value === null) clean[level] = value;
  }
  return Object.keys(clean).length > 0 ? clean : undefined;
}

/**
 * The capability fields a models.json entry should carry. Values the schema rejects
 * are left out, and an empty `thinkingLevelMap: {}` (thinking off) is dropped instead
 * of being written as null.
 */
export function sanitizePiModelCaps(raw) {
  const clean = {};
  const input = sanitizePiInput(raw?.input);
  if (input) clean.input = input;
  if (isBoolean(raw?.reasoning)) clean.reasoning = raw.reasoning;
  const thinkingLevelMap = raw?.reasoning === false ? undefined : sanitizePiThinkingLevelMap(raw?.thinkingLevelMap);
  if (thinkingLevelMap) clean.thinkingLevelMap = thinkingLevelMap;
  return clean;
}

/** Capabilities a newly added model starts with, from resolved caps and thinking levels. */
export function piCapsFromModelCaps(caps, thinkingLevels) {
  const reasoning = caps?.reasoning === true;
  const levels = reasoning ? levelsFromServer(thinkingLevels) : null;
  const seeded = { input: caps?.vision ? ["text", "image"] : ["text"], reasoning };
  if (levels) seeded.thinkingLevelMap = thinkingLevelMapFromLevels(levels);
  return seeded;
}
