-- The prompt builder: one persistent, editable draft per project, shown in a
-- floating window. Annotations append; sending clears it on acceptance.
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
  vim.api.nvim_buf_set_name(buf, "btw-prompt://" .. project)
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
      vim.notify("Cannot save BTW prompt: " .. tostring(err), vim.log.levels.ERROR)
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
  return state
end

local function window(state)
  for _, win in ipairs(vim.fn.win_findbuf(state.buf)) do
    if vim.api.nvim_win_get_tabpage(win) == vim.api.nvim_get_current_tabpage() then
      return win
    end
  end
end

local function close(state)
  local win = window(state)
  if win then
    vim.api.nvim_win_close(win, true)
  end
end

function M.add(project, message)
  local state = queue(project)
  local lines = vim.split(message, "\n", { plain = true })
  local existing = vim.api.nvim_buf_get_lines(state.buf, 0, -1, false)
  if #existing == 1 and existing[1] == "" then
    vim.api.nvim_buf_set_lines(state.buf, 0, -1, false, lines)
  else
    table.insert(lines, 1, "")
    vim.api.nvim_buf_set_lines(state.buf, -1, -1, false, lines)
  end
  if state.save() then
    vim.notify("Added to the BTW prompt")
  end
end

-- Toggle the floating prompt window: open it, focus it, or close it.
function M.open()
  local state = queue(M.project())
  local win = window(state)
  if win then
    if win == vim.api.nvim_get_current_win() then
      vim.api.nvim_win_close(win, true)
    else
      vim.api.nvim_set_current_win(win)
    end
    return
  end
  local width = math.max(20, math.floor(vim.o.columns * 0.8))
  local height = math.max(5, math.floor(vim.o.lines * 0.7))
  win = vim.api.nvim_open_win(state.buf, true, {
    relative = "editor",
    width = width,
    height = height,
    row = math.max(0, math.floor((vim.o.lines - height) / 2) - 1),
    col = math.max(0, math.floor((vim.o.columns - width) / 2)),
    style = "minimal",
    border = "rounded",
    title = " BTW prompt ",
    title_pos = "center",
  })
  vim.wo[win].wrap = true
  vim.wo[win].linebreak = true
  vim.api.nvim_win_set_cursor(win, { vim.api.nvim_buf_line_count(state.buf), 0 })
end

-- Deliver the draft through `transport(message, accepted, finished)`.
-- `accepted` clears the draft unless it changed meanwhile; `finished` always runs.
function M.send(project, transport)
  local state = queue(project)
  if state.sending then
    vim.notify("The BTW prompt is already sending", vim.log.levels.WARN)
    return
  end
  local lines = vim.api.nvim_buf_get_lines(state.buf, 0, -1, false)
  local message = table.concat(lines, "\n")
  if vim.trim(message) == "" then
    vim.notify("The BTW prompt is empty")
    return
  end
  if not state.save() then
    return
  end
  state.sending = true
  transport(message, function()
    local current = vim.api.nvim_buf_get_lines(state.buf, 0, #lines, false)
    if vim.deep_equal(current, lines) then
      vim.api.nvim_buf_set_lines(state.buf, 0, #lines, false, {})
      local rest = vim.api.nvim_buf_get_lines(state.buf, 0, -1, false)
      while #rest > 1 and rest[1] == "" do
        vim.api.nvim_buf_set_lines(state.buf, 0, 1, false, {})
        table.remove(rest, 1)
      end
      state.save()
      if #rest == 1 and rest[1] == "" then
        close(state)
      end
    else
      vim.notify(
        "Pi accepted the prompt. It changed during the send; kept the edited draft.",
        vim.log.levels.WARN
      )
    end
  end, function()
    state.sending = false
  end)
end

return M
