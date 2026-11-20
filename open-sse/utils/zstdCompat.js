import zlib from "node:zlib";
import { isFunction } from "../../src/shared/utils/typeChecks.js";

// zstd decoding only exists from Node 22.15 (zlib.createZstdDecompress). Advertising zstd
// on an older runtime hands back a body undici cannot inflate — raw bytes where JSON/SSE is
// expected (issue #5539).
export const ACCEPT_ENCODING = isFunction(zlib.createZstdDecompress)
  ? "gzip, deflate, br, zstd"
  : "gzip, deflate, br";
