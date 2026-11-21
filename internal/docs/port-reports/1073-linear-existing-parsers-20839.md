# #1073: OmniRoute #20839 and existing DurinDoor parsers

## Source pins and scope

- PR: [OmniRoute #20839](https://github.com/cheaper-inference/OmniRoute/pull/20839)
- Requested implementation head: `fa2199bde75ba499b376be3bc9e4cb6cd08667be`
- Merge commit: `b748429cf5b3aeb142a708fd3e8751b6918b9dc8`
- Compared merge first parent: `355eb07c36fcae2440e6c4407b39542b2000374f`
- The merge changes five implementation paths and five test paths. This review inspected only the five implementation diffs and the corresponding current DurinDoor code; no upstream tests or crafted inputs were used.

## Dispositions

1. **Context7 reference parsing — narrow local hardening warranted; do not port the upstream loop.** `open-sse/handlers/fetch/index.js` parses Context7 references in `parseContext7LibraryId` using `^/([\\w.-]+)/([\\w.-]+)/?$`. Unlike the search normalizer's `CONTEXT7_LIBRARY_ID_RE` in `open-sse/handlers/search/normalizers.js`, fetch parsing does not require each owner/repository segment to start alphanumerically or prohibit dot-only segments. For example, the ordinary supported form `https://context7.com/reactjs/react.dev` is accepted by both; a path whose segment is `..` passes fetch's regex but is excluded by search normalization. This is a real consistency/validation gap visible statically. Recommend sharing or exactly matching the normalizer's existing segment grammar in fetch while preserving accepted host, optional trailing slash, and owner/repo forms. This is a local deterministic parser correction, not a change to Context7 routing or API behavior for valid library ids.

2. **Model display-name parsing — no equivalent change identified.** OmniRoute narrows its `VERSION_MARKER` from allowing one-or-more digits to requiring a digit after `v`. DurinDoor's closest parser is `open-sse/providers/models/namePatterns.js` (`deriveModelName`), with its presentation policy in `open-sse/providers/models/presentation.js`. It uses simple family patterns and a token fallback; it has no matching version-marker rule or the upstream transformation. Ordinary ids such as `gpt-5.3-codex` retain their existing derived labels. No current equivalent needs this change, so preserve the local display grammar.

3. **GitHub model-format selection and newline handling — no inference parser to harden.** OmniRoute narrows its broad Copilot Responses fallback and explicitly rejects line separators before selecting Responses. DurinDoor's provider formats are selected from registry/model metadata and explicit caller overrides (see `open-sse/providers/registry/github.js`, `open-sse/providers/registry/ghe-copilot.js`, and model format resolution in `open-sse/providers/models/schema.js`). No matching model-id regex fallback exists in the current tree. For supported ordinary GitHub Copilot models, explicit format metadata continues to select the declared transport. Do not add inference or alter routing based on this upstream change.

4. **GCF scalar quoting — structurally absent.** The upstream `headroom/gcf/scalar.ts` linear inline-array detector has no counterpart in DurinDoor's compression engine tree (`open-sse/services/compression/engines/`). DurinDoor does not implement GCF serialization or the `[N]:` scalar grammar. Its supported compression surfaces include RTK message handling (`open-sse/rtk/index.js`) and the Headroom adapter/proxy (`open-sse/services/compression/engines/headroomAdapter.js`, `open-sse/rtk/headroom.js`), which operate on message text and fail open. No GCF parser change applies; do not introduce GCF grammar or change those surfaces.

5. **RTK raw-output persistence slug — structurally absent.** The upstream `rtk/rawOutput.ts` edit bounds command-slug processing in an on-disk raw-output persistence feature. DurinDoor's RTK has no raw-output writer, pointer store, or equivalent slug construction (`open-sse/rtk/` and `open-sse/services/compression/`); `rawOutputRetention` in `open-sse/services/compression/types.js` is only a default configuration field, not persistence. Existing compression accepts ordinary message bodies and applies existing RTK/Headroom behavior. There is no corresponding local parser or persistence surface to change.

## Recommendation

Only the Context7 fetch/search grammar mismatch merits a narrow local parser change: align fetch validation with the already stricter search normalizer, preserving the established `/owner/repo` grammar and valid accepted URL forms. The other four upstream changes target a parser or persistence behavior that is absent or materially different in this tree. This report makes no product-code or test changes and does not change request routing.
