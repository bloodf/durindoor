# #1073: OpenCode MiMo effort

[OmniRoute #15299](https://github.com/cheaper-inference/OmniRoute/pull/15299), merged as `07c66b86ee20a67625254179a8237e59305740f5`, is **ported with local scope adaptation**. Its family-wide OpenCode clamp maps `xhigh`, `max`, and `ultra` to `high`, and `minimal` to `low`, leaving accepted values intact. The upstream report describes provider validation; this port does not independently verify it against a live service.

DurinDoor applies the mapping after request translation on its registered MiMo V2.5/V2.6 OpenCode Go, Zen, and Free routes, to present flat `reasoning_effort` and nested `reasoning.effort` and `output_config.effort` carriers. It preserves their shapes and precedence. The local catalog does not register the upstream's other V2.6 variants; they are not added or implicitly enabled. Other models and providers retain their existing behavior. The mock-dispatch regression exercises the ordinary request path without credentials or provider calls.

The [reviewed window](1073-reviewed-window-unmapped-gateway.md) records the gap at its historical comparison head; this report describes the subsequent port. The separate historical #15231 SHA correction does not change that comparison's findings.

Refs #1073
