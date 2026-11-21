# #1073 Responses image replay roles

Compared OmniRoute #3150 head `32bb4b96523d7f880ecd0e547aa3485d654c624b` and first-parent merge `e4a9ec55821bc3baf3ae79499f1dd881cd22eaff` (parent `506a701a1accc286709afd1b71f3914a49c98f64`) with the June existing-response report and current integration.

Chat-to-Responses now represents assistant legacy `image_url` and `input_image` history as `output_text`, while user images retain the existing input conversion. Native Responses replay normalizes legacy user message images and function call output images to `input_image`, and assistant message images to text. Existing `input_image` file references remain untouched. Valid image detail and inline data URLs are retained. The Codex prefetch still handles user images through its existing fetch policy; assistant history is normalized before that step. No new image fetching is introduced.

The upstream patch transforms every item's `output` array. Here only `function_call_output.output` is normalized: this integration already permits its `input_text` and `input_image` parts, whereas message output belongs in `content`, and other item types have distinct output schemas. Non-image parts and call IDs remain intact and in order. Existing Chat tool-image count and byte bounds and file-ID policy are unchanged.

Offline evidence: `cd tests && node node_modules/vitest/vitest.mjs run --maxWorkers=2 unit/omni-responses-image-replay-roles.test.js`. The fixture uses inline images and covers both roles, tool pairing, mixed outputs and untouched unrelated output fields. It tests the repaired behavior rather than the June report's diagnostic expectations.
