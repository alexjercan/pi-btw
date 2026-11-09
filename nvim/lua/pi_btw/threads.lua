local M = {}
local buffers = {}
local group = vim.api.nvim_create_augroup("PiBtwThreads", { clear = true })

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
  return state
end

local function current()
  local buf = vim.api.nvim_get_current_buf()
  for _, state in pairs(buffers) do
    if state.buf == buf then
      return state
    end
  end
end

local function draw(state)
  if not vim.api.nvim_buf_is_valid(state.buf) or not state.thread then
    return
  end
  local lines = {
    "# BTW " .. state.id,
    "",
    ":BtwFollowup [question] | :BtwSend | :close",
    state.busy and "Request in progress..."
      or (
        state.promoted and "Sent to the main agent."
        or "Read-only thread. :BtwSend adds it to the main conversation."
      ),
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
end

function M.show(thread, source)
  local state = state_for(thread.id, source)
  if not state.thread or #state.thread.exchanges ~= #thread.exchanges then
    state.promoted = false
  end
  state.thread = thread
  draw(state)
  local windows = vim.fn.win_findbuf(state.buf)
  if #windows > 0 then
    vim.api.nvim_set_current_win(windows[1])
  else
    vim.cmd("botright vsplit")
    vim.api.nvim_win_set_buf(0, state.buf)
  end
  vim.wo.wrap = true
end

function M.followup(question)
  local state = current()
  if not state or not state.thread then
    vim.notify("Open a BTW thread first", vim.log.levels.WARN)
    return
  end
  local function submit(text)
    if
      not text
      or vim.trim(text) == ""
      or state.busy
      or not vim.api.nvim_buf_is_valid(state.buf)
    then
      return
    end
    state.busy = true
    draw(state)
    require("pi_btw.bridge").ask(
      vim.trim(text),
      function(thread)
        state.thread = thread
        state.promoted = false
        draw(state)
      end,
      state.id,
      function()
        state.busy = false
        draw(state)
      end,
      state.source
    )
  end
  if question and question ~= "" then
    submit(question)
  else
    vim.ui.input({ prompt = "BTW follow-up: " }, submit)
  end
end

function M.send()
  local state = current()
  if not state then
    return false
  end
  if not state.thread or state.busy or state.promoted then
    return true
  end
  state.busy = true
  draw(state)
  require("pi_btw.bridge").promote(state.id, function()
    state.promoted = true
    draw(state)
  end, function()
    state.busy = false
    draw(state)
  end, state.source)
  return true
end

function M.ask(question)
  require("pi_btw.bridge").ask(question, M.show)
end

function M.open(id, source)
  require("pi_btw.bridge").open_thread(id, M.show, source)
end

function M.list()
  require("pi_btw.bridge").list_threads(function(threads, source)
    local items = {}
    for _, thread in ipairs(threads) do
      local state = state_for(thread.id, source)
      -- Native quickfix navigation opens a real buffer. Load its content on entry.
      vim.api.nvim_clear_autocmds({ group = group, buffer = state.buf })
      vim.api.nvim_create_autocmd("BufEnter", {
        group = group,
        buffer = state.buf,
        once = true,
        callback = function()
          require("pi_btw.bridge").open_thread(state.id, function(updated)
            state.thread = updated
            draw(state)
          end, state.source)
        end,
      })
      table.insert(
        items,
        { bufnr = state.buf, lnum = 1, text = thread.id .. " " .. thread.question:gsub("\n.*", "") }
      )
    end
    vim.fn.setqflist({}, " ", { title = "BTW threads: " .. source.label, items = items })
    vim.cmd("copen")
  end)
end

return M
