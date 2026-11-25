# 1073: Admission fixture cold loading

The offline admission fixture imports its independent repositories together after establishing its private environment. During collection, after isolation is established, it loads the real chat route and initializes its translators before the timed setup hook and first request case. Collection failure restores the fixture environment. The production modules, transport mock, fixture data, assertions, and cleanup remain in use.
