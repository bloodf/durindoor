# Antigravity translator refresh

When a stored Antigravity connection receives a 401 or 403 in the translator send route, the shared credential service owns the refresh exchange and its lease-fenced commit. The route retries only after a successful refresh whose result still matches the stored credential context. An active or uncertain lease, or a rejected commit, leaves the original upstream error in place.

This change covers the translator send route. Legacy chat and other direct executor refresh paths still require investigation. Antigravity recovery remains disabled.
