

## Public guide provenance before main integration

- [OmniRoute TinyCMS provider](https://github.com/cheaper-inference/OmniRoute/blob/4265bb2ad5477450a07d3a43ea33a62c6c874878/open-sse/config/providers/registry/tinycms/index.ts) and [executor](https://github.com/cheaper-inference/OmniRoute/blob/4265bb2ad5477450a07d3a43ea33a62c6c874878/open-sse/executors/tinycms.ts)

- Vendored, MIT licensed, from the same pin: [tinycmsSigner.ts](https://github.com/cheaper-inference/OmniRoute/blob/4265bb2ad5477450a07d3a43ea33a62c6c874878/open-sse/executors/tinycmsSigner.ts) (WASM binary and wasm-bindgen glue) and [tinycmsDomMocks.ts](https://github.com/cheaper-inference/OmniRoute/blob/4265bb2ad5477450a07d3a43ea33a62c6c874878/open-sse/executors/tinycmsDomMocks.ts), now under `open-sse/providers/private/tinycms-web/`. The stub window, document, and canvas objects are shared singletons here, because fresh stubs on a later call make the fingerprint report `fp_error`.
