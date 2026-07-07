/**
 * Build the dashboard API payload for one bulk-added provider connection.
 *
 * Bulk provider keys can share endpoint metadata entered once in the modal.
 * Providers without extra metadata keep the historical payload shape.
 */
export function buildBulkProviderConnectionPayload({ provider, apiKey, name, providerSpecificData }) {
  const payload = { provider, apiKey, name, priority: 1, testStatus: "unknown" };

  if (providerSpecificData) {
    payload.providerSpecificData = providerSpecificData;
  }

  return payload;
}
