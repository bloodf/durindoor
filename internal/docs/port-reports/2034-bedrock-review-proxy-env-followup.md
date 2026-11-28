# Bedrock discovery proxy environment follow-up (#2034)

The discovery fixture now clears upper- and lowercase HTTP, HTTPS, ALL and NO
proxy environment variables for each case and restores them afterward. The 35
case bodies and AWS decoys are unchanged. The separate 19-case boundary suite,
including its explicit environment-proxy rejection, remains unchanged.

Before the fixture change, the two suites passed 54/54 in a clean environment.
With synthetic `HTTPS_PROXY` and `ALL_PROXY`, the boundary suite passed 19/19,
but four profile cases in the discovery suite failed: signing, resolver auth
failure, invalid profile name, and resolution timeout. The action route guard
returned `ProfileRouteUnsupported` before those cases reached their intended
outcomes. The contaminated run passed 50/54 and exited 1.

After the change, both clean and contaminated runs passed all 100 tests across
the discovery (35), profile boundary (19), AWS credentials (26), and credential
boundary (20) suites. From the repository root, each run used the following
command; for the contaminated run insert `HTTPS_PROXY=http://127.0.0.1:9
ALL_PROXY=http://127.0.0.1:9` before `timeout`:

```sh
env -i PATH=/home/stormtrooper/.local/bin:/usr/local/bin:/usr/bin:/bin \
  LANG=C.UTF-8 CI=1 HOME=/var/tmp/bedrock-2034-home \
  DATA_DIR=/var/tmp/bedrock-2034-data TMPDIR=/var/tmp/bedrock-2034-tmp \
  XDG_CACHE_HOME=/var/tmp/bedrock-2034-cache \
  GIT_NO_LAZY_FETCH=1 GIT_OPTIONAL_LOCKS=0 timeout 300 sh -c \
  'cd tests && node node_modules/vitest/vitest.mjs run unit/bedrock-sigv4-discovery-2034.test.js unit/fix-bedrock-discovery-profile-boundary-2034.test.js unit/bedrock-aws-credentials.test.js unit/bedrock-credential-boundaries.test.js --maxWorkers=2'
```

The pre-change commands used the same environment and runner with only the first
two files. Transport and profile resolution were mocked; these results do not
establish live AWS permissions or credential-host routing. The action-origin
guard does not control separate profile credential resolution. Source attribution
remains with OmniRoute contributors under MIT, as recorded in the original port
report and manifest.
