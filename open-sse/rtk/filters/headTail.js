// Head+tail elision shared by smart-truncate and read-numbered. A result that
// concatenates several files (`--- path ---`, `=== path ===`, `<file path=…>`)
// splits the line budget per file, so no file disappears without a trace.
import { SMART_TRUNCATE_HEAD, SMART_TRUNCATE_TAIL, SMART_TRUNCATE_MIN_LINES } from "../constants.js";

const RE_FILE_HEADER = /^(?:--- \S.* ---|=== \S.* ===|<file path=.+>)\s*$/;

function elide(lines, headCount, tailCount, note) {
  const cut = lines.length - headCount - tailCount;
  if (cut <= 1) return lines;
  return [...lines.slice(0, headCount), `... +${cut} lines truncated${note}`, ...lines.slice(lines.length - tailCount)];
}

export function headTail(input, note = "") {
  const lines = input.split("\n");
  if (lines.length < SMART_TRUNCATE_MIN_LINES) return input;

  const starts = lines.flatMap((line, index) => RE_FILE_HEADER.test(line) ? [index] : []);
  if (starts.length < 2) return elide(lines, SMART_TRUNCATE_HEAD, SMART_TRUNCATE_TAIL, note).join("\n");

  const budget = Math.max(6, Math.floor((SMART_TRUNCATE_HEAD + SMART_TRUNCATE_TAIL) / starts.length));
  const head = Math.ceil(budget * 2 / 3);
  const cuts = [...new Set([0, ...starts])];
  return cuts.flatMap((start, index) => {
    const segment = lines.slice(start, cuts[index + 1] ?? lines.length);
    // +1 keeps the header line on top of the per-file budget.
    return elide(segment, head + 1, budget - head, note);
  }).join("\n");
}
