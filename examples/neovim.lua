-- Add the checkout's nvim/ directory to runtimepath (or use a plugin manager).
vim.opt.rtp:append(vim.fn.expand("~/personal/pi-btw/nvim"))
require("pi_btw").setup({
  -- target = "%3", -- Optional tmux pane; otherwise discover in this session.
})

-- Build a prompt from code annotations, then send it to a thread or to Pi.
vim.keymap.set({ "n", "x" }, "<leader>bn", ":BtwNote<CR>", { desc = "BTW: annotate into prompt" })
vim.keymap.set("n", "<leader>bq", "<cmd>BtwQueue<CR>", { desc = "BTW: toggle prompt window" })
vim.keymap.set("n", "<leader>bp", "<cmd>BtwSend<CR>", { desc = "BTW: send prompt (thread or Pi)" })
vim.keymap.set("n", "<leader>bt", "<cmd>BtwThreads<CR>", { desc = "BTW: pick a thread" })
-- Shortcuts that skip the prompt window.
vim.keymap.set({ "n", "x" }, "<leader>bb", ":BtwAsk<CR>", { desc = "BTW: annotate and ask thread" })
vim.keymap.set(
  { "n", "x" },
  "<leader>br",
  ":BtwRequest<CR>",
  { desc = "BTW: annotate and request" }
)
