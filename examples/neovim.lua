-- Add the checkout's nvim/ directory to runtimepath (or use a plugin manager).
vim.opt.rtp:append(vim.fn.expand("~/personal/pi-btw/nvim"))
require("pi_btw").setup({
  -- target = "%3", -- Optional tmux pane; otherwise discover in this session.
})

vim.keymap.set({ "n", "x" }, "<leader>n", ":BtwComment<CR>", { desc = "Queue Pi comment" })
vim.keymap.set({ "n", "x" }, "<leader>b", ":BtwAsk<CR>", { desc = "Ask Pi side question" })
vim.keymap.set("n", "<leader>q", "<cmd>BtwQueue<CR>", { desc = "Open Pi queue" })
vim.keymap.set("n", "<leader>f", "<cmd>BtwFollowup<CR>", { desc = "Follow up in BTW thread" })
-- :BtwSend sends the open queue or thread to the main agent.
vim.keymap.set("n", "<leader>s", "<cmd>BtwSend<CR>", { desc = "Send BTW buffer to Pi" })
