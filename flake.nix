{
  description = "Cartographer dev environment (Next.js + Haskell + Supabase)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.11";
    flake-parts.url = "github:hercules-ci/flake-parts";
    haskell-flake.url = "github:srid/haskell-flake";
    process-compose-flake.url = "github:Platonic-Systems/process-compose-flake";
    project-m36.url = "github:plural-reality/project-m36";
  };

  nixConfig = {
    extra-substituters = [ "https://kotto5.cachix.org" ];
    extra-trusted-public-keys = [ "kotto5.cachix.org-1:kIqTVHIxWyPkkiJ24ceZpS6JVvs2BE8GTIA48virk/s=" ];
  };

  outputs =
    inputs@{
      self,
      nixpkgs,
      flake-parts,
      ...
    }:
    let
      envContract = builtins.fromJSON (builtins.readFile ./env-contract.json);
    in
    flake-parts.lib.mkFlake { inherit inputs; } {
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      imports = [
        inputs.haskell-flake.flakeModule
        inputs.process-compose-flake.flakeModule
      ];

      perSystem =
        {
          self',
          system,
          lib,
          config,
          ...
        }:
        let
          # Allow Terraform (BSL license)
          pkgs = import inputs.nixpkgs {
            inherit system;
            config.allowUnfreePredicate =
              pkg:
              builtins.elem (lib.getName pkg) [
                "terraform"
              ];
          };
          # project-m36 の lib を使って override を構築
          m36lib = inputs.project-m36.lib;
          fullOverrides = m36lib.composeOverrides m36lib.m36Overrides (m36lib.mkPkgsDependentOverrides pkgs);

          # Frontend packaging (Sonar pattern: env-contract → checkEnv → launcher)
          nodejs = pkgs.nodejs_20;
          alternativeVarNames = builtins.concatLists envContract.alternatives;
          isUrlVar = name: lib.hasSuffix "_URL" name;
          requiredNonAltVars = lib.filterAttrs (name: v: v.required && !(builtins.elem name alternativeVarNames)) envContract.vars;
          isUrlAlternative = group: builtins.any isUrlVar group;
          appRuntime = {
            requiredEnv = builtins.filter (name: !(isUrlVar name)) (builtins.attrNames requiredNonAltVars);
            requiredUrlEnv = builtins.filter isUrlVar (builtins.attrNames requiredNonAltVars);
            requiredAlternatives = builtins.filter (group: !(isUrlAlternative group)) envContract.alternatives;
            requiredUrlAlternatives = builtins.filter isUrlAlternative envContract.alternatives;
            optionalUrlEnv = builtins.filter isUrlVar (
              builtins.attrNames (lib.filterAttrs (name: v: !(v.required) && !(builtins.elem name alternativeVarNames)) envContract.vars)
            );
            allOrNoneEnvGroups = envContract.allOrNone;
          };
          checkEnv = pkgs.writeShellApplication {
            name = "cartographer-frontend-check-env";
            text = ''
              set -euo pipefail

              missing=()
              invalid=()
              partial=()
              has_value() {
                [ -n "''${!1:-}" ]
              }
              is_http_url() {
                case "''${1:-}" in
                  http://*|https://*) return 0 ;;
                  *) return 1 ;;
                esac
              }

              ${builtins.concatStringsSep "\n" (
                builtins.map (
                  name: ''
                    has_value ${lib.escapeShellArg name} || missing+=(${lib.escapeShellArg name})
                  ''
                ) appRuntime.requiredEnv
              )}

              ${builtins.concatStringsSep "\n" (
                builtins.map (
                  name: ''
                    has_value ${lib.escapeShellArg name} || missing+=(${lib.escapeShellArg name})
                    ! has_value ${lib.escapeShellArg name} || is_http_url "''${${name}}" || invalid+=(${lib.escapeShellArg name})
                  ''
                ) appRuntime.requiredUrlEnv
              )}

              ${builtins.concatStringsSep "\n" (
                builtins.map (
                  group:
                  let
                    shellGroup = builtins.concatStringsSep " " (builtins.map lib.escapeShellArg group);
                  in
                  ''
                    group_has_value=0
                    for name in ${shellGroup}; do
                      has_value "$name" && group_has_value=1
                    done
                    [ "$group_has_value" -eq 1 ] || missing+=("${builtins.concatStringsSep "|" group}")
                  ''
                ) appRuntime.requiredAlternatives
              )}

              ${builtins.concatStringsSep "\n" (
                builtins.map (
                  group:
                  let
                    shellGroup = builtins.concatStringsSep " " (builtins.map lib.escapeShellArg group);
                  in
                  ''
                    group_has_value=0
                    for name in ${shellGroup}; do
                      has_value "$name" && group_has_value=1
                    done
                    [ "$group_has_value" -eq 1 ] || missing+=("${builtins.concatStringsSep "|" group}")
                    for name in ${shellGroup}; do
                      ! has_value "$name" || is_http_url "''${!name}" || invalid+=("$name")
                    done
                  ''
                ) appRuntime.requiredUrlAlternatives
              )}

              ${builtins.concatStringsSep "\n" (
                builtins.map (
                  name: ''
                    ! has_value ${lib.escapeShellArg name} || is_http_url "''${${name}}" || invalid+=(${lib.escapeShellArg name})
                  ''
                ) appRuntime.optionalUrlEnv
              )}

              ${builtins.concatStringsSep "\n" (
                builtins.map (
                  group:
                  let
                    shellGroup = builtins.concatStringsSep " " (builtins.map lib.escapeShellArg group);
                  in
                  ''
                    group_present=0
                    group_missing=0
                    for name in ${shellGroup}; do
                      has_value "$name" && group_present=1 || group_missing=1
                    done
                    [ "$group_present" -eq 0 ] || [ "$group_missing" -eq 0 ] || partial+=("${builtins.concatStringsSep "," group}")
                  ''
                ) appRuntime.allOrNoneEnvGroups
              )}

              [ "''${#missing[@]}" -eq 0 ] || {
                printf 'Missing required environment variables: %s\n' "''${missing[*]}" >&2
                exit 1
              }

              [ "''${#invalid[@]}" -eq 0 ] || {
                printf 'Invalid environment variables: %s\n' "''${invalid[*]}" >&2
                exit 1
              }

              [ "''${#partial[@]}" -eq 0 ] || {
                printf 'Partially configured environment groups: %s\n' "''${partial[*]}" >&2
                exit 1
              }
            '';
          };
        in
        {
          haskellProjects.default = {
            basePackages = pkgs.haskell.packages.ghc96.override {
              overrides = fullOverrides;
            };
            devShell = {
              enable = true;
              tools = hp: {
                cabal-gild = pkgs.haskellPackages.cabal-gild;
                haskell-language-server = hp.haskell-language-server;
                fourmolu = hp.fourmolu;
              };
              # project-m36をdevShellのGHCパッケージDBに含める
              # これによりHLS/cabalが再ビルドを試みなくなる
              extraLibraries = hp: {
                project-m36 = hp.project-m36;
              };

              hlsCheck.enable = false;
            };
            projectRoot = ./backend;
            autoWire = [
              "packages"
              "apps"
              "checks"
            ];
            settings = {
              # TODO: EventId変更に伴いテストファイルの修正が必要
              # テストファイル修正後に削除すること
              cartographer-backend = {
                check = false;
              };
              scotty = {
                jailbreak = true;
              };
              streamly = {
                jailbreak = true;
              };
              lattices = {
                jailbreak = true;
                check = false;
              };
              data-interval = {
                jailbreak = true;
                check = false;
              };
              barbies-th = {
                check = false;
                broken = false;
                jailbreak = true;
              };
              winery = {
                jailbreak = true;
                check = false;
              };
              curryer-rpc = {
                jailbreak = true;
                check = false;
              };
              project-m36 = {
                jailbreak = true;
                custom = pkg: pkgs.haskell.lib.appendConfigureFlag pkg "-f-haskell-scripting";
              };
            };
          };

          apps.export-schema = {
            type = "app";
            program = "${pkgs.writeShellScript "export-schema" ''
              ${lib.getExe self'.packages.cartographer-backend} --export-schema
            ''}";
          };

          # V1シミュレーション用ビルド（ReportGeneratedコンストラクタ欠落版）
          # "v1" という曖昧な名前ではなく、テストにおける役割（特定のスキーマバリアント）を明示
          packages.cartographer-backend-schema-missing-report-constructor =
            self'.packages.cartographer-backend.overrideAttrs
              (old: {
                name = "cartographer-backend-schema-missing-report-constructor";
                # ReportGenerated コンストラクタを削除して V1 をシミュレート
                # さらに、V1と互換性のない実行ファイル（ReportGeneratedを使用するもの）のビルドを無効化
                postPatch = (old.postPatch or "") + ''
                  sed -i 's/| ReportGenerated/-- | ReportGenerated/' src/Domain/Types.hs

                  # 互換性のない実行ファイルを無効化 (buildable: False を挿入)
                  sed -i '/executable schema-evolution-phase2/a \ \ buildable: False' cartographer-backend.cabal
                  sed -i '/executable schema-destructive-phase1/a \ \ buildable: False' cartographer-backend.cabal
                  sed -i '/executable test-projection/a \ \ buildable: False' cartographer-backend.cabal
                  sed -i '/executable test-concurrent/a \ \ buildable: False' cartographer-backend.cabal
                  sed -i '/executable test-performance/a \ \ buildable: False' cartographer-backend.cabal
                  sed -i '/executable test-recovery/a \ \ buildable: False' cartographer-backend.cabal

                  # Disable test suite in this variant as well
                  sed -i '/test-suite cartographer-backend-test/a \ \ buildable: False' cartographer-backend.cabal
                '';
              });

          packages.cartographer-frontend = pkgs.buildNpmPackage {
            pname = "cartographer-frontend";
            version = "0.1.0";
            src = ./.;

            npmDepsHash = "sha256-HJV2tBI3+mcNYw8ZZ7QL0649SFDeff4FLTx6puU0los=";

            nativeBuildInputs = [ pkgs.pkg-config ];
            buildInputs = [ pkgs.vips ];

            # --ignore-scripts: prevent sharp's postinstall from failing in Nix sandbox
            npmFlags = [
              "--legacy-peer-deps"
              "--ignore-scripts"
            ];

            env = {
              NEXT_TELEMETRY_DISABLED = "1";
              NODE_ENV = "development";
              # Keep V8 heap under the nix-daemon build cgroup (MemoryMax in
              # nixos/infrastructure.nix) so `next build` is not OOM-killed on the
              # 4GB t4g.medium target. This build env applies to THIS build (unlike
              # the cgroup limit, which only takes effect after the next activation).
              NODE_OPTIONS = "--max-old-space-size=2048";

              # Build-time placeholders — real values are injected at runtime via EnvironmentFile.
              # Client-side code reads from window.__ENV (populated by layout.tsx), not from these.
              NEXT_PUBLIC_SUPABASE_URL = "https://placeholder.supabase.co";
              NEXT_PUBLIC_SUPABASE_ANON_KEY = "placeholder-anon-key";
              NEXT_PUBLIC_AUTH_SUPABASE_URL = "https://placeholder-auth.supabase.co";
              NEXT_PUBLIC_AUTH_SUPABASE_ANON_KEY = "placeholder-auth-anon-key";
            };

            buildPhase = ''
              runHook preBuild
              export NODE_ENV=production
              npm run build
              runHook postBuild
            '';

            installPhase = ''
              runHook preInstall
              mkdir -p $out/app
              mkdir -p $out/bin

              cp -rT .next/standalone $out/app
              mkdir -p $out/app/.next/static
              cp -r .next/static/* $out/app/.next/static/
              cp -r public $out/app/public

              # Next's image optimizer and fetch cache write to .next/cache at runtime,
              # but the app runs from the read-only nix store. Point .next/cache at a
              # writable dir provided by systemd (CacheDirectory=cartographer-frontend,
              # see nixos/application.nix); the symlink target is resolved at runtime.
              rm -rf $out/app/.next/cache
              ln -s /var/cache/cartographer-frontend $out/app/.next/cache

              cat > $out/bin/cartographer-frontend <<EOF
              #!${pkgs.bash}/bin/bash
              set -euo pipefail
              ${checkEnv}/bin/cartographer-frontend-check-env
              exec ${nodejs}/bin/node $out/app/server.js "\$@"
              EOF
              chmod +x $out/bin/cartographer-frontend

              runHook postInstall
            '';

            meta.mainProgram = "cartographer-frontend";
          };

          packages.cartographer-agent = pkgs.buildNpmPackage {
            pname = "cartographer-agent";
            version = "0.1.0";
            src = ./.;

            npmDepsHash = "sha256-HJV2tBI3+mcNYw8ZZ7QL0649SFDeff4FLTx6puU0los=";

            npmFlags = [
              "--legacy-peer-deps"
              "--ignore-scripts"
            ];

            # Agent only needs node_modules — skip all build phases
            dontNpmBuild = true;
            dontBuild = true;

            env = {
              NEXT_TELEMETRY_DISABLED = "1";
              NODE_ENV = "development";
            };

            installPhase = ''
              runHook preInstall
              mkdir -p $out
              cp -r agents $out/agents
              mkdir -p $out/app/lib
              cp app/lib/session-context.ts $out/app/lib/
              # Shared by agents/llm.ts + PtolemyAgent.ts (audit 2026-10-06 H1/M3).
              cp app/lib/untrusted-text.ts $out/app/lib/
              cp app/lib/sanitize-error.ts $out/app/lib/
              # Session content language (ADR 2026-10-16), used by agents/llm.ts.
              cp app/lib/content-language.ts $out/app/lib/
              cp package.json package-lock.json $out/
              cp -r node_modules $out/node_modules
              # Import from the packaged tree to catch missing runtime modules.
              (cd $out && ${pkgs.nodejs_20}/bin/node node_modules/tsx/dist/cli.mjs \
                -e "import('./agents/PtolemyAgent.ts')")
              runHook postInstall
            '';
          };

          # TODO: EventId変更に伴いテストファイルの修正が必要
          # テストファイル修正後に以下のchecksを復活すること
          checks = config.haskellProjects.default.outputs.checks // {
            # cartographer-backend-test = pkgs.haskell.lib.doCheck self'.packages.cartographer-backend;

            # # Schema Evolution Test: V1 (Old) -> V2 (New)
            # schema-evolution =
            #   pkgs.runCommand "test-schema-evolution"
            #     {
            #       nativeBuildInputs = [ pkgs.glibcLocales ]; # Locale fix if needed
            #     }
            #     ''
            #       export LC_ALL=C.UTF-8
            #       export TEST_DB_PATH=$TMPDIR/m36-evolution-db

            #       echo "--- Phase 1: V1 (InsightExtracted only) ---"
            #       ${self'.packages.cartographer-backend-schema-missing-report-constructor}/bin/schema-evolution-phase1

            #       echo "--- Phase 2: V2 (ReportGenerated added) ---"
            #       ${self'.packages.cartographer-backend}/bin/schema-evolution-phase2

            #       touch $out
            #     '';

            # # Schema Destructive Test: V2 (Full) -> V1 (Removed)
            # schema-destructive =
            #   pkgs.runCommand "test-schema-destructive"
            #     {
            #       nativeBuildInputs = [ pkgs.glibcLocales ];
            #     }
            #     ''
            #       export LC_ALL=C.UTF-8
            #       export TEST_DB_PATH=$TMPDIR/m36-destructive-db

            #       echo "--- Phase 1: V2 (Write all types) ---"
            #       ${self'.packages.cartographer-backend}/bin/schema-destructive-phase1

            #       echo "--- Phase 2: V1 (Read with type removed) ---"
            #       ${self'.packages.cartographer-backend-schema-missing-report-constructor}/bin/schema-destructive-phase2

            #       touch $out
            #     '';

            # # Concurrent Integration Test
            # test-concurrent =
            #   pkgs.runCommand "test-concurrent"
            #     {
            #       nativeBuildInputs = [ pkgs.glibcLocales ];
            #     }
            #     ''
            #       export LC_ALL=C.UTF-8
            #       export TEST_DB_PATH=$TMPDIR/m36-concurrent-db
            #       ${self'.packages.cartographer-backend}/bin/test-concurrent
            #       touch $out
            #     '';

            # # Projection Consistency Test
            # test-projection =
            #   pkgs.runCommand "test-projection"
            #     {
            #       nativeBuildInputs = [ pkgs.glibcLocales ];
            #     }
            #     ''
            #       export LC_ALL=C.UTF-8
            #       export TEST_DB_PATH=$TMPDIR/m36-projection-db
            #       ${self'.packages.cartographer-backend}/bin/test-projection
            #       touch $out
            #     '';
          };

          process-compose.default = {
            cli.options.port = 9999;
            settings = {
              processes = {
                supabase = {
                  command = "supabase start";
                  availability.restart = "no";
                };

                supabase-logs = {
                  command = "docker logs -f $(docker ps --format '{{.Names}}' | grep kong | grep cartographer | head -1) 2>&1";
                  depends_on.supabase.condition = "process_completed_successfully";
                };

                backend = {
                  command = ''
                    export DATABASE_URL="$(supabase status -o env 2>/dev/null | grep '^DB_URL=' | cut -d= -f2- | tr -d '"')"
                    [ -z "$DATABASE_URL" ] && DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
                    exec ${lib.getExe self'.packages.cartographer-backend}
                  '';
                  depends_on.supabase.condition = "process_completed_successfully";
                };

                frontend = {
                  command = "npm run dev -- --port 3000";
                  depends_on.supabase.condition = "process_completed_successfully";
                };

                agent = {
                  command = "npm run agent";
                  depends_on.supabase.condition = "process_completed_successfully";
                };
              };
            };
          };

          devShells.default = pkgs.mkShell {
            name = "cartographer-dev-shell";
            inputsFrom = [
              config.haskellProjects.default.outputs.devShell
            ];

            nativeBuildInputs =
              with pkgs;
              [
                nodejs_20
                supabase-cli
                biome
                pkg-config
                vips
                openssl
                git
                watchman
                libpq.pg_config
                gh # GitHub CLI for workflow management
                config.haskellProjects.default.outputs.finalPackages.project-m36 # Provides tutd, project-m36-server
              ]
              ++ lib.optionals pkgs.stdenv.isDarwin [ libiconv ];

            # Ensure pg_config is available for postgresql-libpq
            shellHook = ''
              export PATH="${pkgs.postgresql}/bin:$PATH"

              # ghc-with-packagesのパッケージDBを指すGHC環境ファイルを生成
              # これによりHLS/cabalがNixでビルドされたパッケージを使用する
              ghc_with_pkgs=$(echo $nativeBuildInputs | tr ' ' '\n' | grep 'ghc-.*-with-packages' | head -1)
              if [ -n "$ghc_with_pkgs" ]; then
                ghc_pkg_db="$ghc_with_pkgs/lib/ghc-$(ghc --numeric-version)/lib/package.conf.d"
                ghc_version=$(ghc --numeric-version)
                env_file=".ghc.environment.$(uname -m)-$(uname -s | tr '[:upper:]' '[:lower:]')-$ghc_version"

                echo "clear-package-db" > "$env_file"
                echo "global-package-db" >> "$env_file"
                echo "package-db $ghc_pkg_db" >> "$env_file"

                echo "✓ Generated $env_file (using ghc-with-packages)"
              else
                echo "⚠ Could not find ghc-with-packages in nativeBuildInputs"
              fi
            '';
          };
        };

      flake = {
        inherit envContract;
      };
    };
}
