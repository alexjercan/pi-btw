{
  description = "Read-only Pi side threads and editable Neovim request queues";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-parts.url = "github:hercules-ci/flake-parts";
    llm-agents = {
      url = "github:numtide/llm-agents.nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = inputs @ {flake-parts, ...}:
    flake-parts.lib.mkFlake {inherit inputs;} {
      systems = ["x86_64-linux" "aarch64-linux" "aarch64-darwin" "x86_64-darwin"];

      perSystem = {
        pkgs,
        system,
        ...
      }: let
        inherit (pkgs) lib;
        agents = inputs.llm-agents.packages.${system};
        manifest = lib.importJSON ./package.json;
        nodejs = pkgs.nodejs_24;
        neovimPlugin = pkgs.vimUtils.buildVimPlugin {
          pname = "pi-btw.nvim";
          version = manifest.version;
          src = ./nvim;
        };
        piBtw =
          pkgs.runCommand "pi-btw-${manifest.version}" {
            passthru = {
              inherit neovimPlugin;
              version = manifest.version;
            };
          } ''
            mkdir -p "$out"
            cp -R ${./extensions} "$out/extensions"
            cp -R ${./nvim} "$out/nvim"
            cp -R ${./examples} "$out/examples"
            cp ${./package.json} "$out/package.json"
            cp ${./README.md} "$out/README.md"
            cp ${./CHANGELOG.md} "$out/CHANGELOG.md"
          '';
        testSource = lib.fileset.toSource {
          root = ./.;
          fileset = lib.fileset.unions [./extensions ./nvim ./tests ./package.json];
        };
      in {
        formatter = pkgs.alejandra;

        packages = {
          default = piBtw;
          pi-btw = piBtw;
          neovim = neovimPlugin;
        };

        devShells.default = pkgs.mkShell {
          packages = [nodejs agents.pi pkgs.neovim pkgs.tmux pkgs.git pkgs.ripgrep pkgs.alejandra pkgs.stylua];
        };

        checks = {
          package =
            pkgs.runCommand "pi-btw-package" {
              nativeBuildInputs = [nodejs pkgs.jq pkgs.neovim];
            } ''
              export HOME="$TMPDIR/home"
              mkdir -p "$HOME"
              root=${piBtw}
              entry=$(jq -r '.pi.extensions[0]' "$root/package.json")
              test -f "$root/''${entry#./}"
              node --experimental-strip-types --input-type=module -e "await import('$root/''${entry#./}')"
              nvim --headless -u NONE -i NONE \
                --cmd 'set rtp^=${neovimPlugin}' \
                -c 'lua require("pi_btw").setup()' -c 'qa!'
              touch "$out"
            '';

          tests =
            pkgs.runCommand "pi-btw-tests" {
              nativeBuildInputs = [nodejs pkgs.neovim pkgs.tmux pkgs.git pkgs.ripgrep];
            } ''
              export HOME="$TMPDIR/home"
              export XDG_RUNTIME_DIR="$TMPDIR/runtime"
              export TMUX_TMPDIR="$TMPDIR/tmux"
              export SHELL=${pkgs.bash}/bin/bash
              mkdir -p "$HOME" "$XDG_RUNTIME_DIR" "$TMUX_TMPDIR"
              chmod 700 "$XDG_RUNTIME_DIR" "$TMUX_TMPDIR"
              cp -R ${testSource} source
              chmod -R u+w source
              cd source
              node --experimental-strip-types --test tests/*.test.ts
              touch "$out"
            '';

          pi-runtime =
            pkgs.runCommand "pi-btw-pi-runtime" {
              nativeBuildInputs = [agents.pi pkgs.jq];
            } ''
              export HOME="$TMPDIR/home"
              mkdir -p "$HOME"
              printf '%s\n' '{"type":"get_commands"}' | \
                pi --mode rpc --no-session --no-extensions \
                --no-skills --no-context-files \
                --extension ${piBtw}/extensions/pi-btw/index.ts > response
              jq -e 'select(.type == "response" and .command == "get_commands") | .success and any(.data.commands[]; .name == "btw")' response
              touch "$out"
            '';

          sdk-runtime =
            pkgs.runCommand "pi-btw-sdk-runtime" {
              nativeBuildInputs = [agents.pi];
            } ''
              export HOME="$TMPDIR/home"
              mkdir -p "$HOME"
              pi --mode rpc --no-session --no-extensions --no-skills \
                --no-context-files --extension ${testSource}/tests/sdk-smoke.ts \
                < /dev/null > response
              grep -q '^BTW_THREAD_SDK_SMOKE_OK$' response
              touch "$out"
            '';

          format =
            pkgs.runCommand "pi-btw-nix-format" {
              nativeBuildInputs = [pkgs.alejandra pkgs.stylua];
            } ''
              alejandra --check ${./flake.nix}
              stylua --check --config-path ${./stylua.toml} ${./nvim} ${./examples}
              touch "$out"
            '';
        };
      };
    };
}
