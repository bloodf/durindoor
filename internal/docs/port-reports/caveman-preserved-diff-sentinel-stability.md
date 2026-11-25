# Caveman preserved diff sentinel stability

Caveman protects unified diffs by replacing them with generated sentinel placeholders, applying compression and custom preservation patterns, then restoring the original spans. The `const_case` rule can match `OMNI_CAVEMAN` inside a placeholder without matching its leading NUL. That changes the token and prevents restoration, so a numeric-only Web Crypto seed made the preserved diff non-identical.

The extraction pass now recognizes the complete generated placeholder range and skips any built-in or custom regex match that overlaps it. This keeps all generated protected spans opaque while leaving ordinary matching and prose compression unchanged. The regression fixes Web Crypto output to numeric-only `0x12` and ordinary `0xab` seeds, exercises custom preservation alongside the existing diff fixture, and restores the stub in `finally`.
