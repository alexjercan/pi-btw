# Changelog

## 0.2.2

- Close the prompt window with `q` and show send hints in its footer, using the user's own keymaps when present.

## 0.2.1

- Rename `:BtwQueue` to `:BtwPrompt`; the old name stays as an alias.
- Remove `:BtwSend`. Use `:BtwSendRequest` or `:BtwSendThread`.
- Remove `:BtwList`. `:BtwConnect` without an argument opens the same picker.
- Suggest the `<leader>b` keymap set where a capital letter means a quick ask or request.

## 0.2.0

- Configure the side model with a `btw` key in Pi's `settings.json`: `model` and `thinkingLevel`, with project settings overriding global ones.
- Keep side-thread tools hardcoded to `read`, `grep`, `find`, and `ls`, with no skills or extensions.
- Render BTW cards in Pi as full plain text with the thread ID for copy and paste.
- Turn the Neovim queue into a prompt builder: `:BtwNote` annotates the cursor line, a visual selection, or a range, and `:BtwQueue` toggles an editable floating prompt window.
- Make `:BtwSend` continue the thread in the current window, or send a request to Pi from anywhere else; add `:BtwSendRequest` and `:BtwSendThread [btw-ID]` for explicit targets.
- Replace the quickfix thread list with a picker in `:BtwThreads` that opens the chosen thread in a vertical split.
- Add `:BtwRequest` and keep `:BtwAsk` as shortcuts that skip the prompt window; `:BtwAsk` continues the open thread.
- Remove `:BtwComment`, `:BtwFollowup`, `:PiBtw`, and thread promotion to the main agent.

## 0.1.2

- Make `:BtwSend` send the current project's queue from outside BTW buffers without opening it.

## 0.1.1

- Restore the bottom-right animated Pi request status for sending, queued, and running work.

## 0.1.0

- Export a Nixvim module with `plugins.pi-btw.enable`, `package`, and `settings` options.
- Discover and select Pi panes without fixed tmux window numbers.
- Add Neovim `:Btw*` commands, target checks, and quickfix thread navigation.
- Use split buffers for queues and threads; move keybindings to user configuration.
- Keep thread actions tied to their source Pi bridge.
- Extract the Pi extension, bridge protocol, and Neovim plugin into one project.
- Provide isolated read-only BTW threads with IDs, follow-ups, and persistent Pi cards.
- Support Neovim thread popups, reopening, and explicit promotion to the main agent.
- Provide persistent editable project queues for file, range, and netrw comments.
- Export Pi and Neovim packages, a development shell, and checks through a Nix flake.
