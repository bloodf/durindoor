const ROW_HEIGHT = 24;

/** Estimate unseen wrapped rows; measured heights replace estimates at the current width. */
export function buildConsoleLayout(entries, wrap, width, heights) {
  // Timestamp, level, gaps and horizontal padding occupy 172px. The monospace
  // text is 12px; use a conservative character width until DOM measurement.
  const columns = Math.max(1, Math.floor((Math.max(width, 320) - 172) / 7.2));
  const offsets = [0];
  for (const entry of entries) {
    const estimated = wrap
      ? ROW_HEIGHT * entry.message.split("\n").reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / columns)), 0)
      : ROW_HEIGHT;
    offsets.push(offsets[offsets.length - 1] + (wrap ? heights.get(entry.id) ?? estimated : ROW_HEIGHT));
  }
  return { offsets, height: offsets[offsets.length - 1] };
}

/** Find the row containing a pixel offset, with overscan measured in rows. */
export function consoleWindow(offsets, top, height, overscan) {
  const count = offsets.length - 1;
  const rowAt = (pixel) => {
    let low = 0;
    let high = count;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (offsets[mid + 1] <= pixel) low = mid + 1;
      else high = mid;
    }
    return low;
  };
  return {
    start: Math.max(0, rowAt(top) - overscan),
    end: Math.min(count, rowAt(top + height) + 1 + overscan),
  };
}
