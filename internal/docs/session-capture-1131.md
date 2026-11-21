# Session capture storage

The client contract is documented in [Configuration](../../docs/configuration.mdx#opt-in-message-capture).
The chat handler starts observation after caller authentication and observes only
the response selected by routing. It snapshots bounded user text before routing
and assembles assistant text from the client-facing JSON or complete event stream.
The observer forwards the original bytes with backpressure and passes only
redacted content, the admitted key ID, the validated UUID and the server's
admission generation to storage. Storage rechecks operator enablement and key
activity and expiry under the write lock. Full logical restores clear previous
captures and fence delayed completions from the pre-restore generation. Engine
cutover mirrors capture rows alongside their owning keys and replaces any rows
left on the target by an earlier cutover.

The repository API is available in `src/lib/db/repos/sessionCaptureRepo.js`.
The standalone write API also requires explicit `consent: true`.

- `captureSessionTurn({ credential, session, consent, turn, retentionMs })`
  stores one redacted JSON turn and returns `true`. It returns `false` when
  capture is disabled, consent is absent, or the key has reached its quota.
  Invalid credentials, session IDs, retention, and oversized turns raise errors.
- `readSessionTurns({ credential, session, limit })` returns up to 100
  unexpired turns for the key and session, ordered by creation time and ID.
  Each row includes `id`, `content`, `createdAt`, and `expiresAt`. The read
  also prunes: it deletes the authenticated key's expired turns before
  selecting, so expired content is physically removed even when no further
  turn is written.
- `deleteSessionTurns({ credential, session })` removes the key's turns for
  that session. Existing captures can still be read and deleted after writes
  are disabled.
- `pruneSessionTurns()` removes expired turns across keys. Writes also prune
  expired turns before checking quota.

## Retention

Expired turns are deleted, not only filtered out of reads. The repository
prunes on three paths:

- A read prunes the authenticated key's expired turns across all of that key's
  sessions, then returns the unexpired turns for the requested session. One
  key's read never deletes another key's turns, so authenticated key isolation
  holds for both the returned rows and the deleted ones.
- A write prunes expired turns before the quota check, so expired bytes never
  block a new turn.
- `pruneSessionTurns()` removes expired turns for every key. It is the
  operator maintenance path for keys that never read or write again.

Reads keep their failure behavior. An invalid session ID, an out-of-range
limit, and a credential that fails authentication are rejected before any row
is deleted, and a rejected read prunes nothing. Reads stay bounded to the
requested limit. While a database cutover blocks writes, the read still
serves rows and skips the prune; the expired turns are removed by the next
read, write, or maintenance pass.

The repository authenticates an active, unexpired API key and uses its stable
ID for storage and access. Session IDs are UUIDs and are normalized to lowercase.
Capture redacts the caller's credential, recognized sensitive fields, bearer
tokens, common API key patterns, JWTs and PEM private-key blocks. Capture stores
message text as sent apart from pattern redaction, so callers who opt in must
not put secrets in message content.

The quota counts redacted UTF-8 JSON bytes. Each turn is limited to 16 KiB, and
each key can retain up to 1 MiB across sessions. At quota, new turns are rejected
until capacity is available. Retention defaults to seven days and can be
shortened in milliseconds. Migration 032 creates the same table and indexes in
SQLite and PostgreSQL.
