// Port concept of filter::smart_truncate (rtk/src/core/filter.rs).
// Keep HEAD + TAIL lines, replace middle with "... +N lines truncated".
import { headTail } from "./headTail.js";

export function smartTruncate(input) {
  return headTail(input);
}

smartTruncate.filterName = "smart-truncate";
