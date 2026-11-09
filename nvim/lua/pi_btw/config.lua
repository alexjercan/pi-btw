local M = {}

M.options = { target = nil }

function M.setup(options)
  M.options = vim.tbl_deep_extend("force", {}, options or {})
end

return M
