local M = {}

local function capture(visual, options, label, submit)
  require("pi_btw.references").capture(visual, options, label, submit)
end

-- Send the current prompt to the main Pi agent as a request.
function M.send_request()
  local queue = require("pi_btw.queue")
  queue.send(queue.project(), function(message, accepted, finished)
    require("pi_btw.bridge").send(message, accepted, finished)
  end)
end

-- Send the current prompt to a thread: the given ID, else the current or
-- last open thread, else a new one.
function M.send_thread(id)
  local threads = require("pi_btw.threads")
  local queue = require("pi_btw.queue")
  local state = threads.active()
  if id and id ~= "" then
    if not state or state.id ~= id then
      require("pi_btw.bridge").open_thread(id, function(thread, source)
        threads.show(thread, source)
        M.send_thread()
      end)
      return
    end
  end
  queue.send(queue.project(), function(message, accepted, finished)
    threads.ask(message, state, accepted, finished)
  end)
end

-- Inside a thread the prompt continues it; anywhere else it goes to Pi.
function M.send()
  if require("pi_btw.threads").current() then
    M.send_thread()
  else
    M.send_request()
  end
end

function M.note(visual, options)
  capture(visual, options, "BTW note", function(message)
    local queue = require("pi_btw.queue")
    queue.add(queue.project(), message)
  end)
end

function M.ask(visual, options)
  capture(visual, options, "BTW ask", function(message)
    local threads = require("pi_btw.threads")
    threads.ask(message, threads.active())
  end)
end

function M.request(visual, options)
  capture(visual, options, "Pi request", function(message)
    require("pi_btw.bridge").send(message)
  end)
end

function M.open_queue()
  require("pi_btw.queue").open()
end

function M.open_thread(id)
  require("pi_btw.threads").open(id)
end

function M.threads()
  require("pi_btw.threads").pick()
end

function M.setup(options)
  require("pi_btw.config").setup(options)
  require("pi_btw.bridge").reset()
  local function command(name, callback, opts)
    vim.api.nvim_create_user_command(name, callback, opts or {})
  end
  local annotate = { nargs = "*", range = true }
  command("BtwNote", function(args)
    M.note(false, args)
  end, vim.tbl_extend("force", annotate, { desc = "Add an annotation to the BTW prompt" }))
  command("BtwAsk", function(args)
    M.ask(false, args)
  end, vim.tbl_extend("force", annotate, { desc = "Annotate and ask in a BTW thread" }))
  command("BtwRequest", function(args)
    M.request(false, args)
  end, vim.tbl_extend("force", annotate, { desc = "Annotate and send a Pi request" }))
  command("BtwQueue", M.open_queue, { desc = "Toggle the BTW prompt window" })
  command("BtwSend", M.send, { desc = "Send the prompt to the current thread or to Pi" })
  command("BtwSendRequest", M.send_request, { desc = "Send the prompt to Pi" })
  command("BtwSendThread", function(args)
    M.send_thread(args.args)
  end, { nargs = "?", desc = "Send the prompt to a BTW thread" })
  command("BtwThreads", M.threads, { desc = "Pick and open a BTW thread" })
  command("BtwOpen", function(args)
    M.open_thread(args.args)
  end, { nargs = 1, desc = "Open a BTW thread by ID" })
  command("BtwConnect", function(args)
    require("pi_btw.bridge").connect(args.args)
  end, {
    nargs = "?",
    complete = function()
      return vim.tbl_map(function(item)
        return item.pane
      end, require("pi_btw.bridge").list())
    end,
  })
  command("BtwList", function()
    require("pi_btw.bridge").connect()
  end)
  command("BtwStatus", function()
    require("pi_btw.bridge").status()
  end)
end

return M
