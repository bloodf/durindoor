# Session capture storage foundation

Session capture is not connected to request handling. The repository API is
available in `src/lib/db/repos/sessionCaptureRepo.js`. Capture defaults to off.
Operators enable writes with `enableSessionCapture: true` in settings. Each
write also requires explicit `consent: true`.

- `captureSessionTurn({ credential, session, consent, turn, retentionMs })`
  stores one redacted JSON turn and returns `true`. It returns `false` when
  capture is disabled, consent is absent, or the key has reached its quota.
  Invalid credentials, session IDs, retention, and oversized turns raise errors.
- `readSessionTurns({ credential, session, limit })` returns up to 100
  unexpired turns for the key and session, ordered by creation time and ID.
  Each row includes `id`, `content`, `createdAt`, and `expiresAt`.
- `deleteSessionTurns({ credential, session })` removes the key's turns for
  that session. Existing captures can still be read and deleted after writes
  are disabled.
- `pruneSessionTurns()` removes expired turns across keys. Writes also prune
  expired turns before checking quota.

The repository authenticates an active, unexpired API key and uses its stable
ID for storage and access. Session IDs are UUIDs and are normalized to lowercase.
Capture redacts the caller's credential, recognized sensitive fields, bearer
tokens, and common API key patterns. Keep credentials in structured sensitive
fields or omit them from the capture payload, as free-form content may contain
secrets in unrecognized formats.

The quota counts redacted UTF-8 JSON bytes. Each turn is limited to 16 KiB, and
each key can retain up to 1 MiB across sessions. At quota, new turns are rejected
until capacity is available. Retention defaults to seven days and can be
shortened in milliseconds. Migration 032 creates the same table and indexes in
SQLite and PostgreSQL.
