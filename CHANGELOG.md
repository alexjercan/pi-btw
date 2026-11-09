# Changelog

## Unreleased

- Export a Nixvim module with `plugins.pi-btw.enable`, `package`, and `settings` options.

- Discover and select Pi panes without fixed tmux window numbers.
- Add Neovim `:Btw*` commands, target checks, and quickfix thread navigation.
- Use split buffers for queues and threads; move keybindings to user configuration.
- Keep thread actions tied to their source Pi bridge.

## 0.1.0

- Extract the Pi extension, bridge protocol, and Neovim plugin into one project.
- Provide isolated read-only BTW threads with IDs, follow-ups, and persistent Pi cards.
- Support Neovim thread popups, reopening, and explicit promotion to the main agent.
- Provide persistent editable project queues for file, range, and netrw comments.
- Export Pi and Neovim packages, a development shell, and checks through a Nix flake.
