export function isAccountIdValid(accountId) {
  return typeof accountId === "string" && accountId.trim().length > 0;
}

export function getAccountIdProviderData(accountId) {
  return isAccountIdValid(accountId) ? { accountId: accountId.trim() } : undefined;
}

export function getProviderHelp(provider) {
  if (provider === "snowflake") {
    return { text: "Find your Snowflake account identifier in Snowsight under account details.", href: "https://docs.snowflake.com/en/user-guide/admin-account-identifier" };
  }
  return { text: "Find your Cloudflare Account ID in the right sidebar of dash.cloudflare.com.", href: "https://dash.cloudflare.com" };
}

// Bulk "Add Keys" guidance, driven by the SAME requiresAccountId flag that
// parseBulkKeyRow uses for row validation — so a user is never shown a row
// shape the parser would reject. Returns plain fields the modal renders as
// real JSX (no raw <code> string is ever printed).
export function getBulkGuidance(opts) {
  const { requiresAccountId = false } = opts || {};
  if (requiresAccountId) {
    return {
      format: "name|apiKey|accountId",
      allowsKeyOnly: false,
      placeholder:
        "name1|sk-key1|acc123456\nname2|sk-key2|def789012\nname3|sk-key3|ghi345678",
    };
  }
  return {
    format: "name|apiKey",
    allowsKeyOnly: true,
    placeholder:
      "name1|sk-key1\nname2|sk-key2\nsk-key-only-auto-named",
  };
}
// Pure parser + validator for the "Bulk Add" rows in AddApiKeyModal.
//
// One row per line. Three shapes depending on the provider:
//   - openai/anthropic/etc.:  "name|apiKey"   or   "apiKey"   (auto-named by index)
//   - cloudflare-ai / snowflake:  "name|apiKey|accountId"
//     The accountId is REQUIRED — a Cloudflare Workers AI or Snowflake Cortex
//     connection without an accountId is unusable. Bulk submissions that omit
//     the accountId are counted as failed and must NOT be POSTed to the
//     provider API.
//
// Exported for ordinary runtime use (called from AddApiKeyModal.handleBulkSubmit)
// and for unit testing. No DOM/fetch side effects — this is a pure function.

/**
 * Prepare a batch of bulk-add lines into the rows eligible for POST.
 *
 * Pure: no DOM, no fetch, no I/O. The modal calls this once at submit time
 * and only iterates the returned `items`. Rows that fail validation
 * (missing/blank accountId for requiresAccountId providers, empty apiKey,
 * etc.) are excluded from `items` and counted in `failed`. This is the
 * contract that "invalid rows must never reach fetch/POST" relies on.
 *
 * @param {string[]} lines - Pre-trimmed, non-empty lines from the textarea.
 * @param {{ requiresAccountId?: boolean, defaultName?: string }} [opts]
 * @returns {{ items: Array<{ name: string, apiKey: string, providerSpecificData?: { accountId: string } }>, failed: number }}
 */
export function prepareBulkKeyRows(lines, opts) {
  const { requiresAccountId = false, defaultName = "Key" } = opts || {};
  const items = [];
  let failed = 0;
  for (let i = 0; i < lines.length; i++) {
    const parsed = parseBulkKeyRow(lines[i], { index: i, requiresAccountId, defaultName });
    if (!parsed.ok) {
      failed++;
      continue;
    }
    const row = { name: parsed.name, apiKey: parsed.apiKey };
    if (parsed.providerSpecificData) {
      row.providerSpecificData = parsed.providerSpecificData;
    }
    items.push(row);
  }
  return { items, failed };
}

/**
 * Parse a single bulk-add row into the data needed to POST /api/providers.
 *
 * @param {string} line - Raw trimmed line from the textarea.
 * @param {{ index: number, requiresAccountId?: boolean, defaultName?: string }} opts
 * @returns {{
 *   ok: boolean,
 *   error?: string,
 *   name?: string,
 *   apiKey?: string,
 *   providerSpecificData?: { accountId: string }
 * }}
 */
 export function parseBulkKeyRow(line, opts) {
  const { index, requiresAccountId = false, defaultName = "Key" } = opts || {};
  if (typeof line !== "string" || line.length === 0) {
    return { ok: false, error: "empty row" };
  }
  const parts = line.split("|");

  if (requiresAccountId) {
    // Format: name|apiKey|accountId. The final segment is the accountId and
    // must be non-empty — a missing or whitespace-only accountId produces a
    // connection that can never be used (Snowflake Cortex and Cloudflare
    // Workers AI both require it to resolve the upstream).
    if (parts.length < 3) {
      return { ok: false, error: "missing accountId (expected name|apiKey|accountId)" };
    }
    const accountId = parts[parts.length - 1].trim();
    if (!accountId) {
      return { ok: false, error: "accountId is empty" };
    }
    const apiKey = parts.slice(1, -1).join("|").trim();
    if (!apiKey) {
      return { ok: false, error: "apiKey is empty" };
    }
    const baseName = parts[0].trim() || defaultName;
    return {
      ok: true,
      name: `${baseName} ${index + 1}`,
      apiKey,
      providerSpecificData: { accountId },
    };
  }

  // Standard shape: name|apiKey OR just apiKey (auto-named).
  if (parts.length >= 2) {
    const baseName = parts[0].trim() || defaultName;
    const apiKey = parts.slice(1).join("|").trim();
    if (!apiKey) {
      return { ok: false, error: "apiKey is empty" };
    }
    return {
      ok: true,
      name: `${baseName} ${index + 1}`,
      apiKey,
    };
  }

  const apiKey = parts[0].trim();
  if (!apiKey) {
    return { ok: false, error: "apiKey is empty" };
  }
  return {
    ok: true,
    name: `${defaultName} ${index + 1}`,
    apiKey,
  };
}
