{pkgs}: let
  inherit (pkgs) lib;
  evaluate = pluginConfig:
    (lib.evalModules {
      specialArgs = {inherit pkgs;};
      modules = [
        ../nixvim.nix
        {
          options = {
            extraPlugins = lib.mkOption {
              type = lib.types.listOf lib.types.package;
              default = [];
            };
            extraConfigLua = lib.mkOption {
              type = lib.types.lines;
              default = "";
            };
          };
          config.plugins.pi-btw = pluginConfig;
        }
      ];
    }).config;
  disabled = evaluate {};
  defaults = evaluate {enable = true;};
  configured = evaluate {
    enable = true;
    settings.target = "%3";
  };
  overridden = evaluate {
    enable = true;
    package = pkgs.emptyDirectory;
  };
  smokeTest = pkgs.writeText "pi-btw-nixvim-smoke.lua" ''
    for _, name in ipairs({ "BtwNote", "BtwAsk", "BtwRequest", "BtwQueue", "BtwSend", "BtwSendRequest", "BtwSendThread", "BtwOpen", "BtwThreads", "BtwList", "BtwConnect", "BtwStatus" }) do
      assert(vim.fn.exists(":" .. name) == 2, name)
    end
    assert(require("pi_btw.config").options.target == vim.env.EXPECTED_TARGET)
    assert(vim.fn.maparg("<leader>bn", "n") == "")
  '';
in
  assert disabled.extraPlugins == [];
  assert disabled.extraConfigLua == "";
  assert builtins.length defaults.extraPlugins == 1;
  assert overridden.extraPlugins == [pkgs.emptyDirectory];
    pkgs.runCommand "pi-btw-nixvim-module" {
      nativeBuildInputs = [pkgs.neovim];
    } ''
      export HOME="$TMPDIR/home"
      mkdir -p "$HOME"
      nvim --headless -u ${pkgs.writeText "pi-btw-default-init.lua" defaults.extraConfigLua} -i NONE \
        --cmd 'set rtp^=${builtins.head defaults.extraPlugins}' -l ${smokeTest}
      EXPECTED_TARGET='%3' nvim --headless \
        -u ${pkgs.writeText "pi-btw-configured-init.lua" configured.extraConfigLua} -i NONE \
        --cmd 'set rtp^=${builtins.head configured.extraPlugins}' -l ${smokeTest}
      touch "$out"
    ''
