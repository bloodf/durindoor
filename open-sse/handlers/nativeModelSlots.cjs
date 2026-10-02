"use strict";

// Native execution-model fields only; never descend into prompts or tool schemas.
function collectNativeModelSlots(body, kind = null) {
  if (!body || typeof body !== "object") return [];
  const slots = [];
  const add = (holder, primary = false) => {
    if (typeof holder?.model === "string") slots.push({ holder, key: "model", primary });
  };
  add(body, true);
  add(body.session, true);
  add(body.session?.delegation?.responses);
  add(body.session?.audio?.input?.transcription, body.session?.type === "transcription");
  add(body.input_audio_transcription, kind === "realtime-transcription");
  if (kind === "batches") {
    for (const item of body.requests || []) add(item?.params);
  }
  for (const tool of body.tools || []) {
    if (typeof tool?.type === "string" && tool.type.startsWith("advisor")) add(tool);
  }
  return slots;
}

module.exports = { collectNativeModelSlots };
