-- Add the checkout's nvim/ directory to runtimepath (or use a plugin manager).
vim.opt.rtp:append(vim.fn.expand("~/personal/pi-btw/nvim"))
require("pi_btw").setup({
  -- target = "%3", -- Optional tmux pane; otherwise discover in this session.
})

-- Build: n(ote) and e(dit). Send: to P(i) or to t(hread). o(pen) a thread.
vim.keymap.set({ "n", "x" }, "<leader>bn", ":BtwNote<CR>", { desc = "BTW: annotate into prompt" })
vim.keymap.set("n", "<leader>be", "<cmd>BtwPrompt<CR>", { desc = "BTW: edit prompt" })
vim.keymap.set("n", "<leader>bp", "<cmd>BtwSendRequest<CR>", { desc = "BTW: send prompt to Pi" })
vim.keymap.set("n", "<leader>bt", "<cmd>BtwSendThread<CR>", { desc = "BTW: send prompt to thread" })
vim.keymap.set("n", "<leader>bo", "<cmd>BtwThreads<CR>", { desc = "BTW: open a thread" })
-- Shift means quick: annotate and send at once, skipping the prompt.
vim.keymap.set({ "n", "x" }, "<leader>bT", ":BtwAsk<CR>", { desc = "BTW: quick ask thread" })
vim.keymap.set({ "n", "x" }, "<leader>bP", ":BtwRequest<CR>", { desc = "BTW: quick request to Pi" })
