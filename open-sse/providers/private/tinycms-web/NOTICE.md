# Vendored TinyCMS signer

`signer.js` (WASM signer and proof-of-work solver, inlined as base64, plus its wasm-bindgen glue) and
`domMocks.js` come from OmniRoute (cheaper-inference/OmniRoute), release/v3.8.55 at
`4265bb2ad5477450a07d3a43ea33a62c6c874878`, files `open-sse/executors/tinycmsSigner.ts` and
`open-sse/executors/tinycmsDomMocks.ts`.

Converted from TypeScript to plain JavaScript; `typeof` checks were replaced with
`src/shared/utils/typeChecks.js` helpers to satisfy the repository lint gate, and the WASM init call passes
`{ module_or_path }`. `domMocks.js` keeps its stub window, document and canvas classes as shared singletons.
The WASM binary is unmodified.

MIT License. Copyright (c) 2026 Cheaper Inference - Created by Diego Souza (https://github.com/diegosouzapw).
Permission is granted, free of charge, to any person obtaining a copy of this software and associated
documentation files, to deal in the software without restriction, subject to the inclusion of this copyright
notice and the MIT permission notice in all copies or substantial portions of the software. The software is
provided "as is", without warranty of any kind.
