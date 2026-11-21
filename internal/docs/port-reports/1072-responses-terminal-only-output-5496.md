# #1072: Responses terminal-only output from 9router #5496

Source: [decolua/9router #5496](https://github.com/decolua/9router/pull/5496), open head `f5b26e176836a8b000e0279833fdb171524ac1cb`, parent `1fe586bb1cf35e1ed0cb2150a8ef7d1db040b21d`. The comparison uses `open-sse/transformer/streamToJsonConverter.js` at that head and the pinned local audit [1072-9r-codex-claude-search-5496.md](1072-9r-codex-claude-search-5496.md), especially its terminal-only output finding.

Upstream merges terminal output into its item map. This independent repair retains the local strict terminal tracker, bounded indexes, duplicate streamed-index rejection and dense ordering. For a successful completed terminal, its output array fills indexes missing from streamed item-done events; previously observed items remain authoritative. Terminal output must be an array of bounded size containing objects. Incomplete terminals retain their prior handling, as do status and usage accounting. No provider or search routing changes are included.

Offline fixtures cover terminal-only and mixed output, native annotations and metadata, existing Claude search and tool projection, usage, malformed output, duplicate indexes and sparse indexes. Claude projection exposes search source URLs through its existing search result blocks; native Responses output retains the original text annotations.
