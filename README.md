# pi-btw

Build prompts from code annotations in Neovim. Send them to a fast, read-only
BTW thread, or to Pi as a request.

## Quickstart

```fish
nix develop
npm ci
pi --no-extensions -e ./extensions/pi-btw/index.ts
```

## Pi extension

`/btw <question>` starts a read-only side thread. `/btw btw-ID <question>`
continues one. Threads only use the `read`, `grep`, `find`, and `ls` tools and
load no skills or extensions. Answers render as plain text cards with the
thread ID, so they are easy to select and paste. Side-thread data stays outside
the main model context.

The side model is configured with a `btw` key in Pi's `settings.json`. The
global file is `~/.pi/agent/settings.json`; a project `.pi/settings.json`
overrides it. Without the key the thread uses the main Pi model with thinking
off.

```json
{
  "btw": { "model": "gpt-6-luna", "thinkingLevel": "medium" }
}
```

- `model`: a model ID from Pi's available catalogue, or `provider/model-id`
  when the same ID exists at several providers.
- `thinkingLevel`: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`.

With the Pi module in nix.dotfiles this is:

```nix
programs.agents.pi.settings.btw = {
  model = "gpt-6-luna";
  thinkingLevel = "medium";
};
```

## Neovim plugin

Run Neovim and Pi in any windows of the same tmux session. Neovim discovers Pi
through a pane option and a local socket. `btw:ready` in Pi means the bridge
is listening, not that Neovim is connected.

Add this to your Neovim config, adjusting the checkout path:

```lua
vim.opt.rtp:append(vim.fn.expand("~/personal/pi-btw/nvim"))
require("pi_btw").setup()
```

With Nixvim, use the module instead. Add `github:alexjercan/pi-btw` as a flake
input and import it:

```nix
programs.nixvim = {
  imports = [ inputs.pi-btw.nixvimModules.default ];
  plugins.pi-btw = {
    enable = true;
    settings = {}; # Optional: { target = "%3"; }
  };
};
```

The module installs the plugin and runs `setup(settings)` for you. There are
no built-in keybindings; see [examples/neovim.lua](examples/neovim.lua) for the
suggested `<leader>b` set.

### Workflow

1. `:BtwNote [text]` (`<leader>bn`): add an annotation to the prompt. It
   records the file and the cursor line, a visual selection, or a command
   range, then asks for a note. Netrw selections add file and folder paths.
   An empty note keeps only the reference.
2. `:BtwQueue` (`<leader>bq`): toggle the prompt in a floating window. Edit it
   freely; it is saved per project and survives restarts. New annotations
   append at the end.
3. `:BtwSend` (`<leader>bp`): inside a thread window, the prompt continues
   that thread. Anywhere else it goes to the main Pi agent as a request. The
   prompt is cleared once Pi accepts it.
4. `:BtwThreads` (`<leader>bt`): pick one of Pi's threads and open it in a
   vertical split. Thread windows are read-only chats; copy from them freely.

Explicit targets:

- `:BtwSendRequest`: send the prompt to Pi.
- `:BtwSendThread [btw-ID]`: send the prompt to the given thread, else to the
  current or last open thread, else start a new thread.
- `:BtwOpen {btw-ID}`: open a thread by ID, for example one seen in Pi.

Shortcuts that skip the prompt window:

- `:BtwAsk [text]` (`<leader>bb`): annotate and ask in the current or last
  open thread, or start a new one. Inside a thread window it is a plain
  follow-up.
- `:BtwRequest [text]`: annotate and send a request to Pi.

Connection commands: `:BtwList` / `:BtwConnect [pane]` / `:BtwStatus` pick,
target, or check Pi. One Pi is selected automatically; multiple instances
prompt for a choice. Use `setup({ target = "%3" })` for a default pane, even in
another tmux session.
