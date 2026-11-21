# #1072: Gemini v1beta thought-part fidelity

Compared local base `99b3f7fc784b43992d31d342a34e27366fa4d517` with open 9router #5386 head `980df24be92cd5a5a33934f1346d33a2ef941cd0`, base `1fe586bb1cf35e1ed0cb2150a8ef7d1db040b21d`, and the exact [native Gemini review](1072-nonstream-and-gemini-v1beta-open-prs.md). The review records the pinned upstream diff and the existing local bridge divergence.

Disposition: repair the request-history fidelity gap in the existing bridge. Upstream routes Gemini history through its native translator; locally that translator collects thought text into `reasoning_content`. The v1beta route calls its own converter and its existing response projection emits `reasoning_content` as Gemini thought parts, establishing the same replay contract. The bridge now collects model thought text into that field, including thought-only turns and turns with calls or media. User text remains user text. The existing bridge continues to own tool pairing, media, system instructions and client projection; it does not forward thought signatures or other unsupported fields. No endpoint, authentication or response behavior changes.

Verification: the focused offline v1beta tool-calling and inline-data fixtures exercise the request bridge and its adjacent behavior. No provider traffic was used.
