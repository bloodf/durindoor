// Handles Cursor/Codex read_file output: "  1|content\n  2|content".
// Strategy mirrors Rust filter::smart_truncate (filter.rs): keep head+tail, drop middle.
import { headTail } from "./headTail.js";

const LINE_RE = /^\s*\d+\|/;

export function readNumbered(input) {
  // Shape already verified by autodetect; here we just truncate.
  return headTail(input, " (file continues)");
}

readNumbered.filterName = "read-numbered";

// Exposed for autodetect
export const READ_NUMBERED_LINE_RE = LINE_RE;
