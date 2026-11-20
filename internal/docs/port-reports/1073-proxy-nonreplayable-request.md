# OmniRoute #5770: non-replayable proxy request bodies

Source: https://github.com/cheaper-inference/OmniRoute/pull/5770, merge source SHA `7581b752af720c43eb60bee9923bfc87a62f4c49` (`open-sse/utils/proxyFetch.ts` and `tests/unit/proxyfetch-undici-retry.test.ts`).

Disposition: adapted to `open-sse/utils/proxyFetch.js` and `tests/unit/omni-proxy-nonreplayable-request.test.js`. OmniRoute guards its dispatcher retry and native fallback; DurinDoor has a different transport structure, so the guard applies to the ordinary non-strict ProxyAgent direct fallback. Stream-like bodies and body-bearing or used Request inputs retain the original proxy error without reading or cloning the body. Replayable bodies keep direct fallback. Strict proxy, abort, quota dispatch, DNS bypass and specialized transport paths retain their existing behavior. No upstream retry or diagnostic mutation was introduced.
