# #1073 Antigravity display reconciliation follow-up

The display clamp in `323f94f117b3a95d137cbc718aca8adeb1c795cb` also fed grouped session reconciliation. A negative legacy fraction consequently appeared exactly zero to that predicate and could exhaust a positive session and replace its reset. The original percentage, calculated before clamping, now remains private to the existing exact-zero family check. The returned legacy percentage remains bounded for display; counts and the established session reset selection remain unchanged.

Offline mocks cover a negative fraction with a positive grouped session and a true zero that exhausts it. The grouped parser and quota persistence are unchanged; no live quota endpoint was called. See the [original port report](1073-antigravity-legacy-display-quota-2700.md) for upstream pins and scope.

Refs #1073
