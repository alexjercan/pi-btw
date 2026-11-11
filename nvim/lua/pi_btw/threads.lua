-- Read-only BTW threads shown as a chat in a vertical split. Each thread
-- buffer stays tied to the Pi bridge that answered it.
local M = {}
local buffers = {}
local last

local function key(id, source)
  return (source and source.socket or "") .. ":" .. id
end

local function state_for(id, source)
  local name = key(id, source)
  local state = buffers[name]
  if state and vim.api.nvim_buf_is_valid(state.buf) then
    return state
  end
  local buf = vim.api.nvim_create_buf(false, true)
  vim.api.nvim_buf_set_name(buf, "btw://" .. vim.fn.sha256(name):sub(1, 12) .. "/" .. id)
  vim.bo[buf].bufhidden = "hide"
  vim.bo[buf].filetype = "markdown"
  state = { buf = buf, source = source, id = id }
  buffers[name] = state
  vim.api.nvim_create_autocmd("BufEnter", {
    buffer = buf,
    callback = function()
      last = state
    end,
  })
  return state
end

local function visible(state)
  if not state or not vim.api.nvim_buf_is_valid(state.buf) then
    return false
  end
  for _, win in ipairs(vim.fn.win_findbuf(state.buf)) do
    if vim.api.nvim_win_get_tabpage(win) == vim.api.nvim_get_current_tabpage() then
      return true
    end
  end
  return false
end

-- The thread shown in the current buffer, if any.
function M.current()
  local buf = vim.api.nvim_get_current_buf()
  for _, state in pairs(buffers) do
    if state.buf == buf then
      return state
    end
  end
end

-- The thread to talk to from anywhere: the current one, or the last used one
-- while it is still open in this tab page.
function M.active()
  local state = M.current()
  if state then
    return state
  end
  if visible(last) then
    return last
  end
end

local function draw(state)
  if not vim.api.nvim_buf_is_valid(state.buf) or not state.thread then
    return
  end
  local lines = {
    "# BTW " .. state.id,
    "",
    state.busy and "Waiting for Pi..." or "Read-only thread. :BtwSendThread continues it.",
  }
  for _, exchange in ipairs(state.thread.exchanges) do
    vim.list_extend(lines, { "", "---", "", "## You", "" })
    vim.list_extend(lines, vim.split(exchange.question, "\n", { plain = true }))
    vim.list_extend(lines, { "", "## BTW", "" })
    vim.list_extend(
      lines,
      vim.split(
        exchange.error and ("Error: " .. exchange.error) or exchange.answer or "",
        "\n",
        { plain = true }
      )
    )
  end
  vim.bo[state.buf].modifiable = true
  vim.api.nvim_buf_set_lines(state.buf, 0, -1, false, lines)
  vim.bo[state.buf].modifiable = false
  for _, win in ipairs(vim.fn.win_findbuf(state.buf)) do
    vim.api.nvim_win_set_cursor(win, { #lines, 0 })
  end
end

function M.show(thread, source)
  local state = state_for(thread.id, source)
  state.thread = thread
  last = state
  draw(state)
  local windows = vim.fn.win_findbuf(state.buf)
  if #windows > 0 then
    vim.api.nvim_set_current_win(windows[1])
  else
    vim.cmd("botright vsplit")
    vim.api.nvim_win_set_buf(0, state.buf)
  end
  vim.wo.wrap = true
  vim.wo.linebreak = true
  vim.api.nvim_win_set_cursor(0, { vim.api.nvim_buf_line_count(state.buf), 0 })
end

-- Ask in `state`, or start a new thread when it is nil. `accepted` runs once
-- an answer arrived; `finished` runs on every outcome.
function M.ask(message, state, accepted, finished)
  if not state then
    require("pi_btw.bridge").ask(message, function(thread, source)
      M.show(thread, source)
      if accepted then
        accepted()
      end
    end, nil, finished)
    return
  end
  if state.busy then
    vim.notify("BTW thread " .. state.id .. " is still answering", vim.log.levels.WARN)
    if finished then
      finished()
    end
    return
  end
  state.busy = true
  last = state
  draw(state)
  require("pi_btw.bridge").ask(
    message,
    function(thread)
      state.thread = thread
      draw(state)
      if accepted then
        accepted()
      end
    end,
    state.id,
    function()
      state.busy = false
      draw(state)
      if finished then
        finished()
      end
    end,
    state.source
  )
end

function M.open(id, source)
  require("pi_btw.bridge").open_thread(id, M.show, source)
end

-- Let the user pick one of Pi's threads; newest first.
function M.pick()
  require("pi_btw.bridge").list_threads(function(threads, source)
    if #threads == 0 then
      vim.notify("No BTW threads in this Pi session")
      return
    end
    local items = {}
    for i = #threads, 1, -1 do
      table.insert(items, threads[i])
    end
    vim.ui.select(items, {
      prompt = "BTW threads (" .. source.label .. "):",
      format_item = function(item)
        return item.id .. "  " .. (item.question:gsub("\n.*", ""))
      end,
    }, function(item)
      if item then
        M.open(item.id, source)
      end
    end)
  end)
end

return M
