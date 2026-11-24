# Ollama Local embedding authentication

Status: implementation and focused tests in this working tree; no port PR has been opened or merged.

- Upstream: [OmniRoute commit 63599ad10ff94c5d5df991ddbfe3819f5ac04b6f](https://github.com/cheaper-inference/OmniRoute/commit/63599ad10ff94c5d5df991ddbfe3819f5ac04b6f), fetched and inspected. It sends an optional configured key as a bearer token for embeddings.
- Basis: DurinDoor HEAD `472a9ec5c194ab79a5585457226236adbf2bedd6`; prior disposition: [row 91 comparison](1073-nov24-row-91-complete.md), [row 91/98 reconciliation](1073-nov24-rows-91-98.md), and [original disposition](1073-nov24-commits-4.md).
- Local finding: `embeddingsCore.js` passes credentials to the Ollama Local adapter, but its `buildHeaders` ignored them. The chat registry configures bearer authentication. The adapter now uses the shared bearer helper when an API key or access token exists and omits authorization otherwise.
- Overlap: on 2026-11-24, the open DurinDoor PR list and changed files for all 13 open PRs had no changes to the Ollama Local embedding adapter or embeddings core.
- Evidence: the new synthetic-key request test failed before the change because the authorization header was absent. After the change, the Ollama Local adapter and shared embeddings core suites passed: 2 files, 48 tests. The existing no-key request test checks that the header is absent. No stored credentials or production gateway were used.
