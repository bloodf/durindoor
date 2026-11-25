# OmniRoute morning port AM4

Status: **PARTIAL**. Candidates 152 and 185 still require disposition.

| Candidate | Upstream | Status | Evidence and remaining work |
| --- | --- | --- | --- |
| 152 | [2608d75c](https://github.com/cheaper-inference/OmniRoute/commit/2608d75c555ec9055e28429f4b39361bbf09dabc) | remaining | The merge adds a 64 MiB default cap on decoded non-streaming response bytes, including error-body reads. No equivalent `responseBodyCap` exists locally; review the distinct readers in `open-sse/handlers/chatCore/` and `open-sse/utils/error.js`, then test chunked and compressed responses. |
| 174 | [7e1f2907](https://github.com/cheaper-inference/OmniRoute/commit/7e1f2907a751781d05d5a2fc5ad209e1daab7e94) | Not applicable | Scheduled model-lock health revalidation is out of scope; upstream `open-sse/services/quotaDailyRevalidation.ts` and `src/lib/credentialHealth/quotaDailyRevalidationRunner.ts` have no local counterparts. |
| 176 | [4b47b2ea](https://github.com/cheaper-inference/OmniRoute/commit/4b47b2ea15287b121c25ab6e52c34fd481d71829) | Not applicable | Scheduled model-lock health revalidation is out of scope; upstream `open-sse/services/quotaDailyRevalidation.ts` and `src/lib/credentialHealth/quotaDailyRevalidationRunner.ts` have no local counterparts. |
| 177 | [a1ef4fd3](https://github.com/cheaper-inference/OmniRoute/commit/a1ef4fd38b28436dff6e149d6b27f9f0b76633e0) | Not applicable | Scheduled model-lock health revalidation is out of scope; upstream `open-sse/services/quotaDailyRevalidation.ts` and `src/lib/credentialHealth/quotaDailyRevalidationRunner.ts` have no local counterparts. |
| 185 | [12932dce](https://github.com/cheaper-inference/OmniRoute/commit/12932dce8da21cf586fb79e1fe3038cd37edaf13) | remaining | `src/shared/components/OAuthModal.js` already supports a missing Cline state for pasted callbacks and accepts pasted Zed Hosted URLs, while `src/lib/oauth/providers.js` still generates a state for both providers. The upstream change suppresses the generated state for Cline and Zed Hosted; local flow lifecycle requires a nonempty state, so equivalence and relayed callbacks need focused verification before changing it. |
| 193 | [666a5e05](https://github.com/cheaper-inference/OmniRoute/commit/666a5e058f90f7388d6a14d5220e738d03a0692e) | Not applicable | Scheduled model-lock health revalidation is out of scope; upstream `open-sse/services/quotaDailyRevalidation.ts` and `src/lib/credentialHealth/quotaDailyRevalidationRunner.ts` have no local counterparts. |
| 199 | [6c9e7c1b](https://github.com/cheaper-inference/OmniRoute/commit/6c9e7c1beeac87746556360add6ec95785a5b8b5) | Not applicable | Scheduled model-lock health revalidation is out of scope; upstream `open-sse/services/quotaDailyRevalidation.ts` and `src/lib/credentialHealth/quotaDailyRevalidationRunner.ts` have no local counterparts. |

No provider calls were made.
