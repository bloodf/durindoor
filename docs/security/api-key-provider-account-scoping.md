# API Key Provider-Account Scoping

Operators can now restrict each API key to a specific subset of provider
accounts. A scoped key only routes through the listed accounts; a key with
no relation rows stays unrestricted and behaves identically to the previous
behaviour, including for legacy `sk-<8 hex>` keys.

## Semantics

- A new join table `apiKeyProviderConnections(apiKeyId, connectionId)` pairs
  API keys with provider-connection ids (migration 014).
- Zero relation rows for a given key means **unrestricted**. Operators opt
  into restriction by assigning at least one connection.
- Removing every relation row restores the unrestricted default. Sending
  `providerConnectionIds: []` clears the restriction.
- `apiKeys.policy.allowedModels` keeps working unchanged. The two
  mechanisms are independent and may be combined.
- `apiKeys.scope` / `apiKeys.connections` are intentionally NOT added. The
  upstream `connections` design is not ported because it is unenforced
  upstream and duplicates the already-shipped `allowedModels` policy.

## Atomicity

`createApiKey` and `updateApiKey` accept a `providerConnectionIds` option.
When present, the key insert/update and the join-table replace run in the
same SQLite transaction. Provider-connection ids are validated inside that
transaction against the live `providerConnections` table, so a stale id
referenced by an in-flight request is rejected before either write commits
and the partial state never lands.

`providerConnectionIds` accepts a deduplicated array of existing
connection ids. Invalid shape, missing connection, or duplicate ids return
HTTP 400 with a precise message and no write occurs.

## Deletion Guard

Deleting a provider connection that is the last scoped account for a key
would silently broaden that key back to unrestricted. The connection and
provider-node delete paths reject the deletion with HTTP 409 and error code
`API_KEY_SCOPE_WOULD_BROADEN`. Operators must first clear the key's
provider-account restriction in the keys UI (or via `PUT /api/keys/[id]`
with `providerConnectionIds: []`) and re-attempt the deletion.

The guard is enforced inside the `deleteProviderConnection` and
`deleteProviderConnectionsByProvider` repo transactions, so the protection
covers every caller (single delete, bulk delete, and provider-node delete
which cascades to all of a provider's connections).

## API Behaviour

- `GET /api/keys` returns the list with each key's `providerConnectionIds`
  plus a `providerConnections` array of `{ id, name, provider }` options.
  No credential material is exposed.
- `GET /api/keys/[id]` returns the same shape for one key.
- `POST /api/keys` accepts an optional `providerConnectionIds` array; the
  saved `key` value, secret generation, and machine id derivation are
  unchanged.
- `PUT /api/keys/[id]` accepts an optional `providerConnectionIds` array.
  Omitting the field preserves the current scope; sending `[]` clears it.
- `DELETE /api/keys/[id]` removes the key and cascades to the join rows.
