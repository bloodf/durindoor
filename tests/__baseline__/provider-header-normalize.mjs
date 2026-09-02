// Claude Code uses host-derived Stainless OS/arch headers. Normalize only
// these two fields so provider baseline snapshots stay host-independent.
const STAINLESS_PLACEHOLDERS = {
  "X-Stainless-Os": "<OS>",
  "X-Stainless-Arch": "<ARCH>",
};

function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (!value || typeof value !== "object") return value;

  const copy = Object.fromEntries(Object.entries(value).map(([key, child]) => [key, normalize(child)]));
  if (copy.headers && typeof copy.headers === "object") {
    for (const [header, placeholder] of Object.entries(STAINLESS_PLACEHOLDERS)) {
      if (header in copy.headers) copy.headers[header] = placeholder;
    }
  }
  return copy;
}

export function normalizeProviderStainless(providers) {
  return normalize(JSON.parse(JSON.stringify(providers)));
}
