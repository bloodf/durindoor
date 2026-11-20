# 1073: Reserved-address policy in the outbound guard

Source: OmniRoute PR 18415 (merged), pinned final head `ea96605531d1298f1692a85b4eba68f13f3716fb`. The final diff adds the reserved 240.0.0.0/4 range, including the limited broadcast address, to the shared host classifier. It keeps 198.18.0.0/15 allowed for fake-IP proxy setups and pins 0.0.0.0/8 and 100.64.0.0/10 in the same spellings.

## Local comparison

The shared classifier is `isPrivateHost` in `open-sse/utils/outboundUrlGuard.js`. It feeds the `public-only` URL check and the connection-time DNS answer check. Before this change it was missing:

- 224.0.0.0/4 (multicast) and 240.0.0.0/4 (reserved, up to the limited broadcast address). The final source diff adds the reserved range on top of a source table that already held multicast; the local table held neither.
- 192.0.0.0/24 (IETF protocol assignments), also present in the source table, and absent locally.
- The NAT64 well-known prefix 64:ff9b::/96, whose embedded IPv4 address was not classified, so a private IPv4 in that spelling was treated as public. The source tests pin this spelling.

All three are now classified by one IPv4 table. IPv4-mapped and NAT64 forms delegate to it, and the NAT64 local-use prefix 64:ff9b:1::/48 is treated as non-public.

## Disposition

Ported with local adaptation: a single `isPrivateHost` change plus a header comment update. No range outside the standard special-use categories was added. Documentation ranges (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24) stay allowed because existing offline fixtures use them as stand-ins for public hosts.

Preserved unchanged: URL parsing and protocol and credential checks, `block-metadata` and `none` mode semantics, the connector and lookup pinning of every DNS answer, manual redirect handling, and the separate `src/shared/utils/ssrfGuard.js` and search/firecrawl host checks, which are outside this port's scope.

## Evidence

`tests/unit/omni-reserved-address-policy.test.js` uses pure classification fixtures and injected lookup stubs. It asserts the hardened contract for reserved addresses in dotted, IPv4-mapped (compressed and expanded) and NAT64 forms, previously covered private ranges, public and benchmarking neighbours, unchanged `block-metadata` and `none` behavior, and DNS-answer handling. Against the unmodified classifier 39 of its 57 assertions fail; with the change all pass. Existing guard, DNS pinning, SSRF, validation-probe and image-address tests pass. No socket, DNS query, credential or provider traffic is used.
