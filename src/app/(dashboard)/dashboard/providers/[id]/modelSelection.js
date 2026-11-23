/** Filter model rows while preserving selection independently of visibility. */
export function filterModelRows(rows, text, group, operator, sort) {
  const query = text.trim().toLowerCase();
  const filtered = rows.filter((model) => {
    const value = [model.id, model.name, model.fullModel, model.alias].filter(Boolean).join(" ").toLowerCase();
    const match = !query || (operator === "notContains" ? !value.includes(query) : operator === "startsWith" ? value.startsWith(query) : operator === "endsWith" ? value.endsWith(query) : operator === "equals" ? value === query : value.includes(query));
    return (group === "all" || model.group === group) && match;
  });
  return sort ? filtered.sort((a, b) => (sort === "asc" ? 1 : -1) * a.id.toLowerCase().localeCompare(b.id.toLowerCase())) : filtered;
}

export function toggleVisibleModels(selected, visible) {
  const keys = visible.map((model) => model.key);
  return keys.every((key) => selected.includes(key)) ? selected.filter((key) => !keys.includes(key)) : [...new Set([...selected, ...keys])];
}

/** Execute each operation independently so failures remain selected for retry. */
export async function runModelOperations(targets, operation) {
  const succeeded = [], failed = [];
  for (const model of targets) {
    try { await operation(model); succeeded.push(model.key); }
    catch { failed.push(model.id); }
  }
  return { succeeded, failed };
}
