// Snapshot current PROVIDERS output to JSON (run on OLD code before refactor).
// Host-dependent X-Stainless-Os / X-Stainless-Arch are normalized to placeholders
// so the baseline file is portable across machines.
// Usage: node tests/__baseline__/snapshot-providers.mjs
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PROVIDERS } from "../../open-sse/config/providers.js";
import { normalizeProviderStainless } from "./provider-header-normalize.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "providers-baseline.json");
const normalized = normalizeProviderStainless(PROVIDERS);
writeFileSync(out, JSON.stringify(normalized, null, 2));
console.log(`Snapshot ${Object.keys(PROVIDERS).length} providers → ${out}`);
