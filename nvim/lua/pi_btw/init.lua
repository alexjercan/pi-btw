local M = {}

function M.comment(visual)
  require("pi_btw.references").comment(visual or false)
end

function M.ask(visual)
  require("pi_btw.references").ask(visual or false)
end

function M.open_queue()
  require("pi_btw.queue").open()
end

function M.open_thread(id)
  require("pi_btw.threads").open(id)
end

function M.setup(options)
  require("pi_btw.config").setup(options)
  require("pi_btw.bridge").reset()
  local function command(name, callback, opts)
    vim.api.nvim_create_user_command(name, callback, opts or {})
  end
  command("BtwAsk", function(args)
    require("pi_btw.references").ask(false, args)
  end, { nargs = "*", range = true, desc = "Ask a read-only side question" })
  command("BtwComment", function(args)
    require("pi_btw.references").comment(false, args)
  end, { nargs = "*", range = true, desc = "Add a reference and comment to the queue" })
  command("BtwQueue", M.open_queue, { desc = "Open the project queue in a vertical split" })
  command("BtwOpen", function(args)
    M.open_thread(args.args)
  end, { nargs = 1 })
  command("PiBtw", function(args)
    M.open_thread(args.args)
  end, { nargs = 1, desc = "Alias for BtwOpen" })
  command("BtwSend", function()
    if not require("pi_btw.threads").send() then
      require("pi_btw.queue").send()
    end
  end)
  command("BtwFollowup", function(args)
    require("pi_btw.threads").followup(args.args)
  end, { nargs = "*" })
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
  command("BtwThreads", function()
    require("pi_btw.threads").list()
  end)
end

return M
