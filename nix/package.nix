# DurinDoor reproducible Nix package derivation evaluation (Issue #1147)
# Source-only evaluation; Nix not installed in this environment.
# Mirrors Dockerfile builder/runner stages and scripts/build-app.mjs materialized assets.

{ pkgs ? import <nixpkgs> {} }:

let
  version = "4.11.0";
  rev = "044632eb8bc4cd51a65340fb6c87100879969e70";
in
pkgs.stdenv.mkDerivation {
  pname = "durindoor";
  inherit version;

  src = pkgs.fetchFromGitHub {
    owner = "bloodf";
    repo = "durindoor";
    inherit rev;
    sha256 = pkgs.lib.fakeSha256; # UNRESOLVED: owner review required
  };

  nativeBuildInputs = [
    pkgs.nodejs_26
    pkgs.python3
    pkgs.gnumake
    pkgs.gcc
    pkgs.linuxHeaders
    pkgs.cmake
  ];

  buildPhase = ''
    export HOME=$TMPDIR
    npm ci --ignore-scripts
    npm run build
  '';

  doCheck = false;

  installPhase = ''
    mkdir -p $out/bin $out/lib/durindoor/server $out/lib/durindoor/cli

    # Copy Next.js standalone runner assets & materialized sidecars (matching Dockerfile)
    cp -r public .next/standalone/.next/static .next/standalone/server.js custom-server.js head-response-guard.cjs web-login-host-boundary.cjs open-sse src/mitm $out/lib/durindoor/server/
    mkdir -p $out/lib/durindoor/server/src/shared/utils $out/lib/durindoor/server/src/shared/constants
    cp src/shared/utils/normalizeEnv.js src/shared/utils/typeChecks.js src/shared/utils/typeChecks.cjs src/shared/utils/wsHandshake.js src/shared/utils/realtimeConfig.js $out/lib/durindoor/server/src/shared/utils/
    cp src/shared/constants/processExitCodes.js $out/lib/durindoor/server/src/shared/constants/

    # Copy native node_modules expected by runner
    mkdir -p $out/lib/durindoor/server/node_modules
    for mod in node-forge next sql.js playwright playwright-core tls-client-node wreq-js @wreq-js; do
      if [ -d node_modules/$mod ]; then
        cp -r node_modules/$mod $out/lib/durindoor/server/node_modules/
      fi
    done

    # Copy CLI package
    cp -r cli/* $out/lib/durindoor/cli/

    # Create wrapper binary
    cat << 'WRAPPER' > $out/bin/durindoor
#!/usr/bin/env node
require('../lib/durindoor/cli/cli.js');
WRAPPER
    chmod +x $out/bin/durindoor
  '';

  meta = with pkgs.lib; {
    description = "DurinDoor - High-performance AI model gateway & dashboard";
    homepage = "https://github.com/bloodf/durindoor";
    license = licenses.mit;
    platforms = platforms.linux;
  };
}
