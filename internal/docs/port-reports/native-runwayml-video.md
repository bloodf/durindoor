# Runway native video staging (#2034)

Pinned read-only OmniRoute HEAD verified as c71f0065a7efe9230ec23b96a12253b050c4d7ad.
Sources: `open-sse/config/videoRegistry.ts` (runwayml entry), `open-sse/config/runway.ts`,
`open-sse/handlers/videoGeneration.ts` (format dispatch and handleRunwayVideoGeneration),
and `open-sse/handlers/videoGeneration/runwayHelpers.ts` (input and output normalization).
The source entry is reachable through its format dispatch, not disabled.

Local comparison: HEAD e7c111f8ba76f01f035675d0ba6ae77cb6334e8e and fetched origin/main
f14f877ec13d6a9c58ed5a7d8f665526f748e76e both have an image Runway adapter and no native
video dispatcher entry. The image adapter already shares Bearer auth, origin, version
2024-11-06 and task polling. It sends all video models to image_to_video, duration 5,
without the source text-to-video branch, source model inventory, or native video ledger
contract. This bundle reuses the existing canonical runwayml identity and runway alias;
it does not create another connection mode or alter any image/cookie/OAuth mode.
No shared registry, catalog or production imports were changed. registration.json lists
serial integration points. CodeGraph retrieval was unavailable (wrapper requires 1.6.2);
bounded checkout searches and direct source inspection supplied the evidence.

Supported subset: five static source models (gen4.5, gen4_turbo, gen3a_turbo, veo3.1,
veo3.1_fast); text prompts; one public HTTPS image via promptImage, prompt_image,
image, image_url or imageUrl; required image for gen4_turbo. The native envelope is
model/promptText/ratio/duration plus optional promptImage/seed. Landscape/portrait
ratios, size orientation, frames/fps duration and numeric seed follow source rounding
and clamping. Default duration 5, range 2–10. Versioned Bearer task API uses fixed origin.
The source Runway registry is static; its model discovery configuration contains no
Runway entry, so no dynamic discovery network API is invented or activated.

Restrictions and deliberate hardening: URL results only, no downloaded/base64 video,
streaming, image arrays/objects, data URIs, provider_options, extra media or unknown
fields. Invalid inputs are rejected before submit. Output/result arrays accept strings
or url/uri/videoUrl/video_url objects, validate every public HTTPS URL through the local
blocked-host policy, and return only URL and mp4 format as in source. URLs are not
fetched locally; no DNS connection is made to an artifact host. This is URL validation,
not a guarantee against later DNS changes at a downstream downloader.

Each call has a maximum 30 second transport/body deadline and total job maximum
300 seconds. Caller cancellation covers submit, poll, body and sleep. Redirects are
refused manually, unexpected response URLs discarded, JSON bodies bounded to 256 KiB,
and upstream text never returned or logged. No retries or submit replay occur, including
transport failure or missing task IDs. Selected credentials and their proxy options
stay local to each invocation; no credential cache or connection selection is added.
Pre-submit abort/validation and explicit 4xx submit refusals carry no acceptedJob.
Uncertain submits, all accepted failures/cancellations and unusable outputs conservatively
carry acceptedJob with unknown cost. This intentionally avoids claiming failed tasks are
free. Cancellation stops local observation; no upstream cancellation endpoint is called.
Successful usage counts returned videos, never requested duration or speculative cost.
Auth/quota HTTP 401/402/403/429 status is retained for the core's selected-connection
handling; no provider response body is exposed or used to declare account-wide quota.

Evidence: focused Vitest closed mocks cover exact headers/body/endpoints, two credentials,
artifact normalization, validation, HTTP refusal/quota, unsafe/malformed results, failed
jobs, redirect refusal, uncertain acceptance/no replay, hung submit, polling deadline,
and cancellation. Only a separate staging describe block asserts non-registration.
No live calls, browser, full suite, or production activation performed.
