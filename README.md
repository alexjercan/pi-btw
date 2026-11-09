# pi-btw

Send questions from Neovim to Pi in Tmux.

## Quickstart

```fish
nix develop
npm ci
pi --no-extensions -e ./extensions/pi-btw/index.ts
```

## How it works

Run Neovim and the quickstart in any windows of the same tmux session.
Neovim discovers Pi through a pane option and a local socket. `btw:ready`
in Pi means the bridge is listening, not that Neovim is connected.

Add this to your Neovim config, adjusting the checkout path:

```lua
vim.opt.rtp:append(vim.fn.expand("~/personal/pi-btw/nvim"))
require("pi_btw").setup()
```

- `:BtwAsk [question]` / `:BtwComment [text]`: ask or queue a cursor/range reference.
- `:BtwQueue` / `:BtwOpen {id}`: open a queue or thread in a vertical split.
- `:BtwFollowup [question]` / `:BtwSend`: follow up or send the current BTW buffer.
- `:BtwThreads`: list active-branch threads in quickfix; Enter opens one.
- `:BtwList` / `:BtwConnect [pane]` / `:BtwStatus`: pick, target, or check Pi.

One Pi is selected automatically; multiple instances prompt for a choice.
Use `setup({ target = "%3" })` for a default pane, even in another tmux session.
There are no built-in keybindings; see [examples/neovim.lua](examples/neovim.lua).
Side answers stay outside the main model context until `:BtwSend`.
