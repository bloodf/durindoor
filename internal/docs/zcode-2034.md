

## Public guide provenance before main integration

The staged catalog lists `glm-5.3` and `glm-5.2`, which follows OmniRoute's list for this provider. The documented V4 stdio interface does not expose a standalone model list, so other ids pass through to the runtime unchanged and the runtime decides whether it can use them. A model id starting with `-` is refused.

- OmniRoute's own fixture uses a binary header and value encoding that does not match first-party V4 NDJSON, so none of its transport was ported.

- [ZCode V4 command schema](https://github.com/zai-org/ZCode/blob/fec975905a2abd4c07e35c40d51fa097a2258ec9/packages/shared/src/zcode-protocol-v4/command.ts)

- [OmniRoute ZCode registry](https://github.com/cheaper-inference/OmniRoute/blob/4265bb2ad5477450a07d3a43ea33a62c6c874878/open-sse/config/providers/registry/zcode/index.ts)

- [OmniRoute ZCode executor](https://github.com/cheaper-inference/OmniRoute/blob/4265bb2ad5477450a07d3a43ea33a62c6c874878/open-sse/executors/zcode.ts)
