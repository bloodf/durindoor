
### OpenAI batch input limits

OpenAI batch input files are limited by `MAX_BATCH_BYTES` (default 104857600 bytes), `MAX_BATCH_LINE_BYTES` (default 1048576 bytes per JSONL line, excluding LF or CRLF), and `MAX_BATCH_ITEMS` (default 100000 nonblank lines). Set each to a positive integer to change its limit; invalid values use the default. Limits also apply when creating a batch from an existing stored file. Multipart uploads are parsed before the file size check, so configure an upstream request body limit as well.
