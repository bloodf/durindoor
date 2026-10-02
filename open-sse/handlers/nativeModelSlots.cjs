"use strict";
const { isObject, isString } = require("../../src/shared/utils/typeChecks.cjs");

// Native execution-model fields only; never descend into prompts or tool schemas.
function collectNativeModelSlots(body, kind = null) {
  if (!body || !isObject(body)) return [];
  if (kind === "batches" && body.requests != null && !Array.isArray(body.requests)) {
    throw new TypeError("Native model containers must be arrays");
  }
  const slots = [];
  const add = (holder, path, primary = false) => {
    if (isString(holder?.model)) slots.push({ holder, key: "model", path: [...path, "model"], primary });
  };
  const addTools = (holder, path) => {
    if (holder?.tools == null) return;
    if (!Array.isArray(holder.tools)) throw new TypeError("Native tools must be an array");
    for (const [index, tool] of holder.tools.entries()) {
      if (isString(tool?.type) && tool.type.startsWith("advisor")) add(tool, [...path, "tools", index]);
    }
  };
  add(body, [], true);
  add(body.session, ["session"], true);
  add(body.session?.delegation?.responses, ["session", "delegation", "responses"]);
  add(body.session?.audio?.input?.transcription, ["session", "audio", "input", "transcription"], body.session?.type === "transcription");
  add(body.input_audio_transcription, ["input_audio_transcription"], kind === "realtime-transcription");
  if (kind === "batches") {
    for (const [index, item] of (body.requests || []).entries()) {
      const path = ["requests", index, "params"];
      add(item?.params, path);
      addTools(item?.params, path);
    }
  }
  addTools(body, []);
  addTools(body.session, ["session"]);
  addTools(body.session?.delegation?.responses, ["session", "delegation", "responses"]);
  return slots;
}

module.exports = { collectNativeModelSlots };
