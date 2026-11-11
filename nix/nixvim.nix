{
  config,
  lib,
  pkgs,
  ...
}: let
  cfg = config.plugins.pi-btw;
  manifest = lib.importJSON ../package.json;
in {
  options.plugins.pi-btw = {
    enable = lib.mkEnableOption "Pi side threads and the Neovim prompt builder";

    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.vimUtils.buildVimPlugin {
        pname = "pi-btw.nvim";
        version = manifest.version;
        src = ../nvim;
      };
      defaultText = lib.literalExpression "the bundled pi-btw Neovim plugin";
      description = "Neovim plugin package to install.";
    };

    settings = lib.mkOption {
      type = lib.types.attrsOf lib.types.anything;
      default = {};
      example = {target = "%3";};
      description = "Options passed to pi_btw.setup. Keybindings remain user-defined.";
    };
  };

  config = lib.mkIf cfg.enable {
    extraPlugins = [cfg.package];
    extraConfigLua = ''
      require("pi_btw").setup(${lib.generators.toLua {} cfg.settings})
    '';
  };
}
