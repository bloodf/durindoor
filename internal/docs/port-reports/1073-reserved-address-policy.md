# 1073: Reserved-address policy in the outbound guard

Source: OmniRoute PR 18415 (merged), pinned final head `ea96605531d1298f1692a85b4eba68f13f3716fb`. The final diff adds the reserved 240.0.0.0/4 range, including the limited broadcast address, to the shared host classifier. It keeps 198.18.0.0/15 allowed for fake-IP proxy setups and pins 0.0.0.0/8 and 100.64.0.0/10 in the same spellings.

## Local comparison

The shared classifier is `isPrivateHost` in `open-sse/utils/outboundUrlGuard.js`. It feeds the `public-only` URL check and the connection-time DNS answer check. Before this change it was missing:

- 224.0.0.0/4 (multicast) and 240.0.0.0/4 (reserved, up to the limited broadcast address). The final source diff adds the reserved range on top of a source table that already held multicast; the local table held neither.
- 192.0.0.0/24 (IETF protocol assignments), also present in the source table, and absent locally. The local table later makes room for the two globally reachable anycast reservations inside that block (see below).
- The NAT64 well-known prefix 64:ff9b::/96, whose embedded IPv4 address was not classified, so a private IPv4 in that spelling was treated as public. The source tests pin this spelling.

All three are now classified by one IPv4 table. IPv4-mapped and NAT64 forms delegate to it, and the NAT64 local-use prefix 64:ff9b:1::/48 is treated as non-public.

## The 192.0.0.0/24 exception: two globally reachable anycast allocations

The 192.0.0.0/24 block is *not* uniformly non-public. IANA's IPv4 Special-Purpose Address Registry (last updated 2025-10-09) carries the footnote "Not useable unless by virtue of a more specific reservation" on the 192.0.0.0/24 row, so a blanket `/24` deny is only correct for the addresses that have no more specific reservation.

Two more specific reservations inside the block carry **Globally Reachable = True**:

| Address block | Name | RFC | Globally Reachable |
| --- | --- | --- | --- |
| 192.0.0.9/32 | Port Control Protocol Anycast | RFC 7723 | True |
| 192.0.0.10/32 | Traversal Using Relays around NAT Anycast | RFC 8155 | True |

These are real, routable anycast destinations: a PCP (RFC 7723) or TURN (RFC 8155) server is reachable at them from anywhere, they are `Reserved-by-Protocol = False`, and they behave like any other public address for a connection target. Blocking them rejects a legitimate public endpoint, which is why the `/24` rule has to make room for them.

Every other address in the block stays non-public, because its own registry row says so:

- 192.0.0.0/29 — IPv4 Service Continuity Prefix (RFC 7335), Globally Reachable = False.
- 192.0.0.8/32 — IPv4 dummy address (RFC 7600), Globally Reachable = False.
- 192.0.0.170/32 and 192.0.0.171/32 — NAT64/DNS64 discovery (RFC 8880, RFC 7050), Globally Reachable = False and Reserved-by-Protocol = True.
- Everything else in 192.0.0.0/24 — no more specific reservation, so the block's own row applies.

The distinction is *global reachability*, not "special-purpose" in the loose sense. Other globally reachable anycast reservations in the IANA registry (192.31.196.0/24 AS112-v4, 192.52.193.0/24 AMT, 192.175.48.0/24 Direct Delegation AS112) sit outside 192.0.0.0/24 and were never denied by this classifier.

## Disposition

Ported with local adaptation: a single `isPrivateHost` change plus a header comment update. No range outside the standard special-use categories was added. Documentation ranges (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24) stay allowed because existing offline fixtures use them as stand-ins for public hosts.

The anycast follow-up narrows that one rule without touching any other: the 192.0.0.0/24 deny keeps every address except 192.0.0.9 and 192.0.0.10. Both spellings that delegate to the IPv4 table (IPv4-mapped and NAT64) follow automatically, so the exception applies to 192.0.0.9, 192.0.0.10, `::ffff:192.0.0.9`, `::ffff:192.0.0.10` and their NAT64 forms alike.

Preserved unchanged: URL parsing and protocol and credential checks, `block-metadata` and `none` mode semantics, the connector and lookup pinning of every DNS answer, manual redirect handling, and the separate `src/shared/utils/ssrfGuard.js` and search/firecrawl host checks, which are outside this port's scope.

## Evidence

`tests/unit/omni-reserved-address-policy.test.js` uses pure classification fixtures and injected lookup stubs. It asserts the hardened contract for reserved addresses in dotted, IPv4-mapped (compressed and expanded) and NAT64 forms, previously covered private ranges, public and benchmarking neighbours, unchanged `block-metadata` and `none` behavior, and DNS-answer handling. Against the unmodified classifier 39 of its 57 assertions fail; with the change all pass. Existing guard, DNS pinning, SSRF, validation-probe and image-address tests pass. No socket, DNS query, credential or provider traffic is used.

The anycast follow-up adds 16 assertions to the same file, covering the static classification of 192.0.0.9 and 192.0.0.10 in dotted, IPv4-mapped (compressed and expanded) and NAT64 spellings, their acceptance as `public-only` URL targets and as resolved addresses, the same acceptance through an injected lookup stub, and the still-blocked neighbours 192.0.0.0, 192.0.0.7, 192.0.0.8, 192.0.0.11, 192.0.0.170 and 192.0.0.171. The file grows from 57 to 73 tests; reverting only the classifier change fails 7 of them, so the new coverage is load-bearing. `unit/outbound-url-guard-dns-pinning.test.js`, `unit/security-hardening.test.js`, `unit/web-fetch-ssrf-607.test.js` and `unit/loopback-proxy-bypass.test.js` still pass unchanged (181 assertions over the five files). No socket, DNS query, credential or provider traffic is used.
