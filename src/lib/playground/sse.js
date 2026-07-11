// Minimal, correct SSE event parser for the Playground streams.
//
// Buffers RAW bytes (decoded text) and finds event boundaries with a /\r?\n\r?\n/ separator
// scanned incrementally from a cursor. Keeping the buffer raw (NOT eagerly normalizing CRLF)
// is load-bearing: a delimiter split across two pushes (e.g. "...\r" + "\n\r\n") must still be
// recognized. Eagerly replacing \r\n with \n would leave a lone trailing \r that breaks the
// next boundary match.
//
// Within one event block, lines are split on /\r?\n/ and every `data:` line is joined with "\n"
// (per the SSE spec). The trailing buffer at EOF is emitted via flush() even with no final
// newline (covers streams that end without a blank line — needed for the terminal usage chunk).

const SEP = /\r?\n\r?\n/g;

/**
 * @param {(event:{data:string})=>void} onEvent
 */
export function createSseParser(onEvent) {
  let buffer = "";
  let cursor = 0;

  function processBlock(block) {
    if (!block) return;
    const dataLines = [];
    for (const raw of block.split(/\r?\n/)) {
      if (raw.startsWith(":")) continue; // comment/heartbeat
      if (raw.startsWith("data:")) {
        let v = raw.slice(5);
        if (v.startsWith(" ")) v = v.slice(1); // one optional leading space per spec
        dataLines.push(v);
      }
    }
    if (dataLines.length === 0) return;
    const data = dataLines.join("\n");
    if (data === "[DONE]") return;
    onEvent({ data });
  }

  function scan() {
    SEP.lastIndex = cursor;
    let match;
    let lastEnd = cursor;
    while ((match = SEP.exec(buffer)) !== null) {
      const block = buffer.slice(lastEnd, match.index);
      processBlock(block);
      lastEnd = match.index + match[0].length;
      SEP.lastIndex = lastEnd;
    }
    buffer = buffer.slice(lastEnd);
    cursor = 0;
  }

  return {
    push(text) {
      if (!text) return;
      buffer += text;
      scan();
    },
    flush() {
      if (buffer.trim()) processBlock(buffer);
      buffer = "";
      cursor = 0;
    },
  };
}
