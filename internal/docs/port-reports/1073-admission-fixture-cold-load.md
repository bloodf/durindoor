# 1073: Admission fixture cold loading

The offline admission fixture imports its independent repositories together after establishing its private environment. A separate setup hook loads the real chat route and initializes its translators before the first request case, so cold dependency loading does not consume that case's timeout. The production modules, transport mock, fixture data, assertions, and cleanup remain in use.
