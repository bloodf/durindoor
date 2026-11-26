const identitySegment = (apiKeyKey) => apiKeyKey.split(":").at(-1).slice(0, 8);

/**
 * Tell apart API keys that share a display name (port of 9router #2364).
 * The usage dashboard groups its API-key table by `keyName`, so two keys with
 * one name would be summed into one group. Only colliding names get a suffix,
 * taken from the non-secret `apiKeyKey` identity.
 *
 * @param {Record<string, object>|undefined} byApiKey usage buckets
 * @returns {Record<string, object>} new buckets with unambiguous `keyName`s
 */
export function disambiguateApiKeyNames(byApiKey) {
  const identitiesByName = new Map();
  for (const { keyName, apiKeyKey } of Object.values(byApiKey || {})) {
    if (!apiKeyKey) continue;
    if (!identitiesByName.has(keyName)) identitiesByName.set(keyName, new Set());
    identitiesByName.get(keyName).add(apiKeyKey);
  }

  const labelFor = ({ keyName, apiKeyKey }) => {
    const identities = identitiesByName.get(keyName);
    if (!apiKeyKey || !identities || identities.size < 2) return keyName;
    const short = identitySegment(apiKeyKey);
    const shortIsUnique = [...identities].filter((id) => identitySegment(id) === short).length === 1;
    return `${keyName} (${shortIsUnique ? short : apiKeyKey})`;
  };

  return Object.fromEntries(Object.entries(byApiKey || {}).map(([key, row]) =>
    [key, { ...row, keyName: labelFor(row) }]));
}
