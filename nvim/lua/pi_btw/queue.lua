local M = {}
local queues = {}

function M.project()
  local cwd = vim.fn.getcwd()
  return vim.fs.root(cwd, ".git") or cwd
end

local function queue(project)
  if queues[project] then
    return queues[project]
  end
  local directory = vim.fn.stdpath("state") .. "/pi-queues"
  vim.fn.mkdir(directory, "p", 448)
  local path = directory .. "/" .. vim.fn.sha256(project) .. ".md"
  local buf = vim.api.nvim_create_buf(false, true)
  vim.api.nvim_buf_set_name(buf, "pi-queue://" .. project)
  vim.bo[buf].filetype = "markdown"
  vim.bo[buf].bufhidden = "hide"
  vim.bo[buf].swapfile = false
  if vim.fn.filereadable(path) == 1 then
    vim.api.nvim_buf_set_lines(buf, 0, -1, false, vim.fn.readfile(path))
  end
  local state = { buf = buf }
  queues[project] = state

  function state.save()
    local lines = vim.api.nvim_buf_get_lines(buf, 0, -1, false)
    local temporary = path .. "." .. vim.fn.getpid() .. ".tmp"
    local ok, err = pcall(function()
      vim.fn.writefile(lines, temporary)
      vim.fn.setfperm(temporary, "rw-------")
      assert(vim.uv.fs_rename(temporary, path))
    end)
    if not ok then
      vim.notify("Cannot save Pi queue: " .. tostring(err), vim.log.levels.ERROR)
    end
    return ok
  end

  vim.api.nvim_create_autocmd({ "TextChanged", "TextChangedI", "BufLeave" }, {
    buffer = buf,
    callback = function()
      state.save()
    end,
  })
  vim.api.nvim_create_autocmd("VimLeavePre", {
    callback = function()
      state.save()
    end,
  })
  function state.send()
    if state.sending then
      vim.notify("Pi queue is already sending", vim.log.levels.WARN)
      return
    end
    local lines = vim.api.nvim_buf_get_lines(buf, 0, -1, false)
    local message = table.concat(lines, "\n")
    if vim.trim(message) == "" then
      vim.notify("Pi queue is empty")
      return
    end
    if not state.save() then
      return
    end
    state.sending = true
    require("pi_btw.bridge").send(message, function()
      local current = vim.api.nvim_buf_get_lines(buf, 0, #lines, false)
      if vim.deep_equal(current, lines) then
        vim.api.nvim_buf_set_lines(buf, 0, #lines, false, {})
        state.save()
      else
        vim.notify(
          "Pi accepted the draft. Queue changed during send; kept the edited draft.",
          vim.log.levels.WARN
        )
      end
    end, function()
      state.sending = false
    end)
  end
  return state
end

function M.add(project, message)
  local state = queue(project)
  local lines = vim.api.nvim_buf_get_lines(state.buf, 0, -1, false)
  if #lines == 1 and lines[1] == "" then
    lines = {}
  else
    table.insert(lines, "")
    table.insert(lines, "---")
    table.insert(lines, "")
  end
  vim.list_extend(lines, vim.split(message, "\n", { plain = true }))
  vim.api.nvim_buf_set_lines(state.buf, 0, -1, false, lines)
  if state.save() then
    vim.notify("Comment queued for Pi")
  end
end

function M.open()
  local state = queue(M.project())
  for _, win in ipairs(vim.fn.win_findbuf(state.buf)) do
    vim.api.nvim_set_current_win(win)
    return
  end
  vim.cmd("botright vsplit")
  vim.api.nvim_win_set_buf(0, state.buf)
  vim.wo.wrap = true
end

function M.send()
  local buf = vim.api.nvim_get_current_buf()
  for _, state in pairs(queues) do
    if state.buf == buf then
      state.send()
      return true
    end
  end
  queue(M.project()).send()
  return true
end

return M
