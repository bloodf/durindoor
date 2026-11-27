import { normalizeTokenSaverEvent } from "../../rtk/index.js";

/**
 * @typedef {"rtk"|"headroom"|"session-dedup"|"lite"|"caveman"|"caveman-prompt"|"pxpipe"} CompressionStageId
 * @typedef {ReturnType<typeof normalizeTokenSaverEvent> & {stages: CompressionStageId[]}} CompressionEvent
 */
const STAGE_IDS = new Set(["rtk", "headroom", "session-dedup", "lite", "caveman", "caveman-prompt", "pxpipe"]);

/**
 * Add typed stage identities to the compatible saver event. Stack estimates
 * remain in `compression`; the frozen DB column projection is unchanged.
 * @returns {CompressionEvent}
 */
export function normalizeCompressionEvent(event) {
  return {
    ...normalizeTokenSaverEvent(event),
    stages: [...new Set((event?.stages ?? []).filter((id) => STAGE_IDS.has(id)))],
  };
}
