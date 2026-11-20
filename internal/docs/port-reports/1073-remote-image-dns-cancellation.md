# 1073: Remote image DNS cancellation

Source: #11755. Follow-up to the regression reported in #2097 and inventoried in #1073.

Remote image lookup now observes the existing per-fetch deadline or caller signal while DNS is pending. Cancellation returns without starting fetch, and a late DNS result or error is consumed. Successful lookups still validate all addresses and pin the connection; redirect refusal, image signature and byte limits remain in place. The timer remains scoped to remote image resolution.

The focused offline fixture uses a deferred mocked DNS lookup for an ordinary public URL. It covers caller abort, deadline expiry, late resolver success and failure, and successful conversion to a data URL; it makes no live requests.
