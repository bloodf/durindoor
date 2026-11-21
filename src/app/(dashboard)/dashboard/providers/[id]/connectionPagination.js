/** Paginate filtered connections, clamping the page after removals or filter changes. */
export function connectionPage(connections, requestedPage, pageSize = 25) {
  const pageCount = Math.max(1, Math.ceil(connections.length / pageSize));
  const page = Math.min(pageCount, Math.max(1, requestedPage));
  return { page, pageCount, items: connections.slice((page - 1) * pageSize, page * pageSize) };
}

/** Toggle only the current page, retaining selections on other pages and filters. */
export function togglePageSelection(selectedIds, connections) {
  const ids = new Set(connections.map((connection) => connection.id));
  if (ids.size === 0) return selectedIds;
  if ([...ids].every((id) => selectedIds.includes(id))) {
    return selectedIds.filter((id) => !ids.has(id));
  }
  return [...new Set([...selectedIds, ...ids])];
}
