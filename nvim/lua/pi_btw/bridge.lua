local M = {}
local selected

local function tmux(args)
  local output = vim.fn.systemlist(vim.list_extend({ "tmux" }, args))
  if vim.v.shell_error == 0 then
    return output
  end
end

local function target(pane)
  local ids = tmux({ "display-message", "-p", "-t", pane, "#{pane_id}" })
  if not ids or not ids[1] then
    return
  end
  local id = ids[1]
  local sockets = tmux({ "show-options", "-p", "-v", "-t", id, "@pi_nvim_socket" })
  if not sockets or not sockets[1] or sockets[1] == "" then
    return
  end
  -- Query fields separately: recent tmux versions sanitize control delimiters.
  local labels =
    tmux({ "display-message", "-p", "-t", id, "#{session_name}:#{window_index}.#{pane_index}" })
  return { pane = id, label = labels and labels[1] or id, socket = sockets[1] }
end

function M.list()
  if not vim.env.TMUX_PANE then
    return {}, "Neovim is not in tmux"
  end
  local session = tmux({ "display-message", "-p", "-t", vim.env.TMUX_PANE, "#{session_id}" })
  if not session or not session[1] then
    return {}, "Cannot find the current tmux session"
  end
  local panes = tmux({ "list-panes", "-s", "-t", session[1], "-F", "#{pane_id}" })
  local result = {}
  for _, pane in ipairs(panes or {}) do
    local item = target(pane)
    if item then
      table.insert(result, item)
    end
  end
  return result
end

local function choose(callback)
  local items, err = M.list()
  if #items == 0 then
    vim.notify(err or "No Pi bridges in this tmux session", vim.log.levels.WARN)
    callback(nil)
    return
  end
  vim.ui.select(items, {
    prompt = "Pi target:",
    format_item = function(item)
      return item.label .. " (" .. item.pane .. ")"
    end,
  }, callback)
end

function M.connect(pane)
  if pane and pane ~= "" then
    local item = target(pane)
    if not item then
      vim.notify("No Pi bridge at " .. pane, vim.log.levels.ERROR)
      return
    end
    selected = item
    vim.notify("Pi target: " .. item.label .. " (" .. item.pane .. ")")
  else
    choose(function(item)
      if item then
        selected = item
        vim.notify("Pi target: " .. item.label .. " (" .. item.pane .. ")")
      end
    end)
  end
end

function M.reset()
  selected = nil
end

-- A target includes the socket generation. Never silently redirect an old buffer
-- to a new Pi session that happens to occupy the same pane.
function M.resolve(callback, cancelled)
  local function use(item)
    if not item then
      if cancelled then
        cancelled()
      end
      return
    end
    selected = item
    callback(vim.deepcopy(item))
  end
  if selected then
    use(selected)
  elseif require("pi_btw.config").options.target then
    local item = target(require("pi_btw.config").options.target)
    if not item then
      vim.notify("Configured Pi target is unavailable", vim.log.levels.ERROR)
    end
    use(item)
  else
    local items, err = M.list()
    if #items == 1 then
      use(items[1])
    elseif #items > 1 then
      choose(use)
    else
      vim.notify(err or "No Pi bridges in this tmux session", vim.log.levels.ERROR)
      use(nil)
    end
  end
end

local function request(message, kind, accepted, finished, answer, thread_id, source)
  local function send(item)
    local current = target(item.pane)
    if not current or current.socket ~= item.socket then
      vim.notify(
        "Pi target changed or closed; use :BtwConnect to select it again",
        vim.log.levels.ERROR
      )
      if finished then
        finished()
      end
      return
    end
    local pipe = vim.uv.new_pipe(false)
    local timer = vim.uv.new_timer()
    local done, acknowledged = false, false
    local buffer = ""
    local id = tostring(vim.uv.hrtime())
    local function finish(err, response)
      if done then
        return
      end
      done = true
      timer:stop()
      timer:close()
      if not pipe:is_closing() then
        pipe:close()
      end
      if finished then
        finished()
      end
      if err then
        vim.notify(err, vim.log.levels.ERROR)
      elseif answer then
        answer(response, item)
      else
        vim.notify("Pi finished")
      end
    end
    timer:start(
      130000,
      0,
      vim.schedule_wrap(function()
        finish("Pi request timed out")
      end)
    )
    pipe:connect(item.socket, function(err)
      if done then
        return
      end
      if err then
        vim.schedule(function()
          finish("Cannot connect to Pi: " .. err)
        end)
        return
      end
      pipe:read_start(function(read_error, chunk)
        if done then
          return
        end
        if read_error or not chunk then
          vim.schedule(function()
            finish(read_error or "Pi bridge disconnected")
          end)
          return
        end
        buffer = buffer .. chunk
        if #buffer > 2 * 1024 * 1024 then
          vim.schedule(function()
            finish("Pi response is too long")
          end)
          return
        end
        while true do
          local newline = buffer:find("\n", 1, true)
          if not newline then
            break
          end
          local line = buffer:sub(1, newline - 1)
          buffer = buffer:sub(newline + 1)
          local ok, response = pcall(vim.json.decode, line)
          vim.schedule(function()
            if done then
              return
            end
            if not ok or type(response) ~= "table" or (response.id and response.id ~= id) then
              finish("Invalid Pi bridge response")
            elseif response.status == "running" or response.status == "queued" then
              if not acknowledged then
                acknowledged = true
                if kind == "prompt" or kind == "btw-promote" then
                  timer:stop()
                end
                vim.notify("Pi: " .. response.status)
                if accepted then
                  accepted()
                end
              end
            elseif response.status == "done" then
              finish(nil, response)
            elseif response.status == "error" then
              finish(response.error or "Pi rejected the request")
            else
              finish("Unknown Pi bridge response")
            end
          end)
        end
      end)
      pipe:write(
        vim.json.encode({ id = id, message = message, kind = kind, threadId = thread_id }) .. "\n"
      )
    end)
  end
  if source then
    send(source)
  else
    M.resolve(send, finished)
  end
end

local function thread_answer(callback)
  return function(response, source)
    local thread = response.thread
    if
      type(thread) ~= "table"
      or type(thread.id) ~= "string"
      or type(thread.exchanges) ~= "table"
    then
      vim.notify("Pi returned no BTW thread", vim.log.levels.ERROR)
      return
    end
    callback(thread, source)
  end
end

function M.send(message, accepted, finished)
  request(message, "prompt", accepted, finished)
end

function M.ask(message, answer, thread_id, finished, source)
  request(message, "btw", nil, finished, thread_answer(answer), thread_id, source)
end

function M.open_thread(thread_id, answer, source)
  request("Open BTW thread", "btw-open", nil, nil, thread_answer(answer), thread_id, source)
end

function M.promote(thread_id, accepted, finished, source)
  request("Send BTW thread", "btw-promote", accepted, finished, nil, thread_id, source)
end

function M.status()
  request("Pi status", "info", nil, nil, function(response, source)
    local info = response.info
    if type(info) ~= "table" then
      vim.notify("Pi returned no status", vim.log.levels.ERROR)
      return
    end
    vim.notify(
      string.format(
        "Pi %s (%s)\nProject: %s\nSession: %s",
        source.label,
        source.pane,
        info.cwd,
        info.sessionId
      )
    )
  end)
end

function M.list_threads(callback)
  request("List BTW threads", "btw-list", nil, nil, function(response, source)
    if type(response.threads) ~= "table" then
      vim.notify("Pi returned no thread list", vim.log.levels.ERROR)
      return
    end
    callback(response.threads, source)
  end)
end

return M
