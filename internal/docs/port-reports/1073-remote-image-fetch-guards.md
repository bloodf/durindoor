# 1073: Remote-image fetch guard comparison

Static comparison with OmniRoute PR #11755 at `faebf6de5f1f6e4c78c6281ffb175eea21821d95` identified an inconsistency between the existing public-address policy and remote-image adapters. The local implementation retains its established pinned image connection, bounded response, image signature checks, and redirect refusal while applying the shared public-address decision to the adapters. Chat and Codex continue to use the same guarded image fetcher. Credential-bearing ChatGPT asset transports are outside this change.

See [the implementation report](1073-remote-image-address-policy.md) for the patch and positive regression evidence. This comparison is static; no live requests were made.
