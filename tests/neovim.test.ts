import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

const runtime = `vim.opt.rtp:prepend(${JSON.stringify(resolve("nvim"))})`;
function runLua(body: string, temp?: string) {
  const directory = temp ?? mkdtempSync(join(tmpdir(), "pi-btw-nvim-"));
  const script = join(directory, "test.lua");
  writeFileSync(
    script,
    `local ok, err = xpcall(function()\n${runtime}\n${body}\nend, debug.traceback)
    if not ok then io.stderr:write(err); vim.cmd("cquit 1") end`,
  );
  try {
    const result = spawnSync(
      "nvim",
      [
        "--headless",
        "-u",
        "NONE",
        "-i",
        "NONE",
        "-c",
        `luafile ${script}`,
        "-c",
        "qa!",
      ],
      {
        encoding: "utf8",
        timeout: 10000,
        env: { ...process.env, XDG_STATE_HOME: join(directory, "state") },
      },
    );
    assert.equal(result.status, 0, result.stderr);
  } finally {
    if (!temp) rmSync(directory, { recursive: true, force: true });
  }
}

test("discovery is session-scoped, supports explicit panes, and rejects replaced targets", () => {
  const session = `pi-btw-discovery-${process.pid}`;
  const other = `${session}-other`;
  const tmux = (...args: string[]) =>
    execFileSync("tmux", args, { encoding: "utf8" }).trim();
  const pane = tmux(
    "new-session",
    "-d",
    "-s",
    session,
    "-P",
    "-F",
    "#{pane_id}",
  );
  try {
    const outside = tmux(
      "new-session",
      "-d",
      "-s",
      other,
      "-P",
      "-F",
      "#{pane_id}",
    );
    const pi = tmux(
      "new-window",
      "-d",
      "-t",
      `=${session}:7`,
      "-P",
      "-F",
      "#{pane_id}",
    );
    const second = tmux(
      "new-window",
      "-d",
      "-t",
      `=${session}:9`,
      "-P",
      "-F",
      "#{pane_id}",
    );
    for (const item of [pi, second, outside])
      tmux("set-option", "-p", "-t", item, "@pi_nvim_socket", `/fake/${item}`);
    runLua(`
      vim.env.TMUX_PANE = ${JSON.stringify(pane)}
      require("pi_btw").setup()
      local bridge = require("pi_btw.bridge")
      assert(#bridge.list() == 2, "Discovery must exclude other tmux sessions")
      local picked = 0
      vim.ui.select = function(items, _, callback)
        picked = picked + 1
        assert(#items == 2)
        callback(items[1])
      end
      local selected
      bridge.resolve(function(item) selected = item end)
      assert(picked == 1 and selected)
      bridge.resolve(function(item) assert(item.socket == selected.socket) end)
      assert(picked == 1, "Selection must be sticky")
      bridge.connect(${JSON.stringify(outside)})
      bridge.resolve(function(item) assert(item.pane == ${JSON.stringify(outside)}) end)
      require("pi_btw").setup({ target = ${JSON.stringify(pi)} })
      bridge.resolve(function(item) assert(item.pane == ${JSON.stringify(pi)}) end)
      vim.fn.system({ "tmux", "set-option", "-p", "-t", ${JSON.stringify(pi)}, "@pi_nvim_socket", "/replacement" })
      local error_text, finished
      vim.notify = function(message) error_text = message end
      bridge.send("Must not redirect", function() error("Must not send") end, function() finished = true end)
      assert(finished and error_text:find("changed or closed", 1, true))
      require("pi_btw").setup({ target = "%99999999" })
      bridge.resolve(function() error("Must not fall back") end, function() finished = true end)
      assert(error_text:find("Configured Pi target is unavailable", 1, true))
      vim.fn.system({ "tmux", "set-option", "-p", "-u", "-t", ${JSON.stringify(second)}, "@pi_nvim_socket" })
      require("pi_btw").setup()
      bridge.resolve(function(item) assert(item.pane == ${JSON.stringify(pi)}) end)
      assert(picked == 1, "A sole instance must not prompt")
      vim.env.TMUX_PANE = nil
      local items, err = bridge.list()
      assert(#items == 0 and err == "Neovim is not in tmux")
    `);
  } finally {
    tmux("kill-session", "-t", `=${session}`);
    tmux("kill-session", "-t", `=${other}`);
  }
});

test("bridge restores animated progress and cleans it up on every request outcome", () => {
  runLua(`
    require("pi_btw").setup()
    local bridge = require("pi_btw.bridge")
    local path = vim.fn.tempname()
    local source = { pane = "%7", socket = path, label = "work:7.0" }
    vim.fn.systemlist = function(args)
      if args[2] == "show-options" then return { source.socket } end
      if args[#args] == "#{pane_id}" then return { source.pane } end
      return { source.label }
    end
    bridge.resolve = function(callback) callback(source) end
    local notices = {}
    vim.notify = function(message) table.insert(notices, message) end
    local timers = {}
    local new_timer = vim.uv.new_timer
    vim.uv.new_timer = function()
      local timer = new_timer()
      table.insert(timers, timer)
      return {
        start = function(_, delay, interval, callback)
          timer:start(delay == 130000 and 500 or delay, interval, callback)
        end,
        stop = function() timer:stop() end,
        close = function() timer:close() end,
      }
    end
    local server = vim.uv.new_pipe(false)
    assert(server:bind(path))
    local peer, received
    server:listen(8, function()
      peer = vim.uv.new_pipe(false)
      server:accept(peer)
      peer:read_start(function(_, chunk) if chunk then received = true end end)
    end)
    local function start()
      received = false
      local finished, accepted = 0, 0
      local current = vim.api.nvim_get_current_win()
      bridge.send("Test", function() accepted = accepted + 1 end, function() finished = finished + 1 end)
      assert(vim.api.nvim_get_current_win() == current, "Progress must not steal focus")
      local win
      for _, item in ipairs(vim.api.nvim_list_wins()) do
        if vim.api.nvim_win_get_config(item).relative == "editor" then win = item end
      end
      assert(win, "Missing progress float")
      local config = vim.api.nvim_win_get_config(win)
      assert(not config.focusable and config.row > vim.o.lines / 2 and config.col > vim.o.columns / 2)
      local buf = vim.api.nvim_win_get_buf(win)
      local function text() return vim.api.nvim_buf_get_lines(buf, 0, -1, false)[1] end
      assert(text() == "| sending")
      return text, function()
        assert(vim.wait(2000, function() return finished == 1 end))
        assert(not vim.api.nvim_win_is_valid(win) and not vim.api.nvim_buf_is_valid(buf))
        assert(timers[#timers]:is_closing() and timers[#timers - 1]:is_closing())
        return accepted
      end
    end
    local text, finish = start()
    assert(vim.wait(1000, function() return received end))
    peer:write('{"status":"queued"}\\n')
    assert(vim.wait(1000, function() return text():find("queued", 1, true) end))
    local frame = text():sub(1, 1)
    assert(vim.wait(1000, function() return text():sub(1, 1) ~= frame end), "Spinner must animate")
    peer:write('{"status":"running"}\\n')
    assert(vim.wait(1000, function() return text():find("running", 1, true) end))
    peer:write('{"status":"done"}\\n')
    assert(finish() == 1, "Acceptance callback must only run once")
    peer:close()
    for _, outcome in ipairs({ "error", "disconnect", "invalid", "timeout" }) do
      local _, cleanup = start()
      assert(vim.wait(1000, function() return received end))
      if outcome == "error" then peer:write('{"status":"error","error":"Rejected"}\\n')
      elseif outcome == "disconnect" then peer:close()
      elseif outcome == "invalid" then peer:write('not-json\\n') end
      cleanup()
      if not peer:is_closing() then peer:close() end
    end
    source.socket = path .. "-missing"
    local _, cleanup = start()
    cleanup()
    assert(notices[#notices]:find("Cannot connect", 1, true))
    server:close()
    vim.fn.delete(path)
    assert(vim.wait(150, function() return false end) == false) -- drain late spinner callbacks
    for _, notice in ipairs(notices) do
      assert(notice ~= "Pi: queued" and notice ~= "Pi: running")
    end
  `);
});

test("setup exposes commands without installing mappings", () => {
  runLua(`
    vim.g.mapleader = " "
    local plugin = require("pi_btw")
    plugin.setup({ target = "%42" })
    plugin.setup({ target = "%42" }) -- setup is repeatable
    assert(require("pi_btw.config").options.target == "%42")
    for _, name in ipairs({ "BtwNote", "BtwAsk", "BtwRequest", "BtwPrompt", "BtwQueue", "BtwSendRequest", "BtwSendThread", "BtwThreads", "BtwOpen", "BtwConnect", "BtwStatus" }) do
      assert(vim.fn.exists(":" .. name) == 2, name)
    end
    for _, gone in ipairs({ "BtwSend", "BtwList", "BtwComment", "BtwFollowup", "PiBtw" }) do
      assert(vim.fn.exists(":" .. gone) ~= 2, gone) -- 1 is a prefix of BtwSendRequest
    end
    for _, mode in ipairs({ "n", "x" }) do
      for _, key in ipairs({ "bn", "be", "bp", "bt", "bo", "bT", "bP" }) do assert(vim.fn.maparg(" " .. key, mode) == "") end
    end
    assert(#vim.api.nvim_buf_get_keymap(0, "n") == 0)
  `);
});

test("the prompt window is a floating modal that toggles, edits, and appends", () => {
  const temp = mkdtempSync(join(tmpdir(), "pi-prompt-test-"));
  mkdirSync(join(temp, "project", ".git"), { recursive: true });
  const setup = `
    require("pi_btw").setup()
    vim.cmd.cd(${JSON.stringify(join(temp, "project"))})
    local queue = require("pi_btw.queue")
    local function text() return table.concat(vim.api.nvim_buf_get_lines(0, 0, -1, false), "\\n") end
    local function float()
      for _, win in ipairs(vim.api.nvim_list_wins()) do
        if vim.api.nvim_win_get_config(win).relative == "editor" then return win end
      end
    end
  `;
  try {
    runLua(
      setup +
        `
      local code = vim.api.nvim_get_current_win()
      vim.cmd.BtwPrompt()
      local win = float()
      assert(win and win == vim.api.nvim_get_current_win(), "Prompt must open as a focused float")
      local config = vim.api.nvim_win_get_config(win)
      assert(config.border ~= "none" and config.width >= 20 and config.height >= 5)
      assert(vim.bo.modifiable and vim.bo.filetype == "markdown")
      local maps = vim.api.nvim_buf_get_keymap(0, "n")
      assert(#maps == 1 and maps[1].lhs == "q", "Only q is mapped in the editable prompt")
      local function footer()
        local text = ""
        for _, part in ipairs(vim.api.nvim_win_get_config(float()).footer) do text = text .. part[1] end
        return text
      end
      assert(footer():find("q close", 1, true) and footer():find(":BtwSendRequest send to Pi", 1, true), footer())
      assert(footer():find(":BtwSendThread send to thread", 1, true), footer())
      vim.cmd.normal("q")
      assert(not float() and vim.api.nvim_get_current_win() == code, "q closes the prompt")
      vim.g.mapleader = " "
      vim.keymap.set("n", "<leader>bp", "<cmd>BtwSendRequest<CR>")
      vim.keymap.set("n", "<leader>bt", ":BtwSendThread<CR>")
      vim.cmd.BtwPrompt()
      assert(footer():find("<leader>bp send to Pi | <leader>bt send to thread", 1, true), footer())
      vim.keymap.del("n", "<leader>bp"); vim.keymap.del("n", "<leader>bt")
      vim.g.mapleader = nil
      vim.cmd.BtwPrompt() -- alias
      assert(not float() and vim.api.nvim_get_current_win() == code, "Toggle closes the float")
      queue.add(queue.project(), "/tmp/a.lua:3-5\\nFirst note")
      vim.cmd.BtwPrompt()
      assert(text() == "/tmp/a.lua:3-5\\nFirst note")
      vim.api.nvim_buf_set_lines(0, -1, -1, false, { "Typed inside the modal" })
      vim.api.nvim_win_set_cursor(0, { 2, 3 })
      queue.add(queue.project(), "/tmp/b.lua:7\\nSecond note")
      assert(text() == "/tmp/a.lua:3-5\\nFirst note\\nTyped inside the modal\\n\\n/tmp/b.lua:7\\nSecond note")
      assert(vim.deep_equal(vim.api.nvim_win_get_cursor(0), { 2, 3 }), "Appending must not move the cursor")
      vim.api.nvim_set_current_win(code)
      assert(float(), "Leaving keeps the float open")
      vim.cmd.BtwPrompt()
      assert(vim.api.nvim_get_current_win() == float(), "Toggle focuses an open float")
    `,
      temp,
    );
    runLua(
      setup +
        `
      vim.cmd.BtwPrompt()
      assert(text():find("Typed inside the modal", 1, true), "Draft must survive restart")
      assert(text():find("Second note", 1, true))
    `,
      temp,
    );
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("sending the prompt to Pi clears only unchanged drafts", () => {
  const temp = mkdtempSync(join(tmpdir(), "pi-send-test-"));
  mkdirSync(join(temp, "project", ".git"), { recursive: true });
  mkdirSync(join(temp, "other"));
  const setup = `
    require("pi_btw").setup()
    vim.cmd.cd(${JSON.stringify(join(temp, "project"))})
    local sent, accept, finish
    package.loaded["pi_btw.bridge"] = {
      send = function(message, accepted, finished) sent, accept, finish = message, accepted, finished end,
      ask = function() error("Must not ask a thread outside thread buffers") end,
    }
    local queue = require("pi_btw.queue")
    local function send() vim.cmd.BtwSendRequest() end
    local function text() return table.concat(vim.api.nvim_buf_get_lines(0, 0, -1, false), "\\n") end
    local function float()
      for _, win in ipairs(vim.api.nvim_list_wins()) do
        if vim.api.nvim_win_get_config(win).relative == "editor" then return win end
      end
    end
  `;
  try {
    runLua(
      setup +
        `
      queue.add(queue.project(), "/tmp/a.lua:3-5\\nEdited comment")
      local current, windows = vim.api.nvim_get_current_buf(), #vim.api.nvim_list_wins()
      send()
      assert(sent:find("Edited comment", 1, true), "Send must load the saved prompt without opening it")
      assert(vim.api.nvim_get_current_buf() == current and #vim.api.nvim_list_wins() == windows)
      local first_send = accept
      send(); assert(accept == first_send, "Do not send the prompt twice while busy")
      finish() -- failed send must retain the draft
      vim.cmd.BtwPrompt()
      assert(text():find("Edited comment", 1, true))
      local draft = text()
      send(); assert(sent == draft); finish()
      assert(text() == draft)
      send(); queue.add(queue.project(), "Appended while sending"); accept(); finish()
      assert(float(), "A leftover draft keeps the modal open")
      assert(not text():find("Edited comment", 1, true))
      assert(text() == "Appended while sending", text())
      send(); vim.api.nvim_buf_set_lines(0, 0, -1, false, { "Changed during send" }); accept(); finish()
      assert(text() == "Changed during send")
      assert(float(), "An edited draft keeps the modal open")
      send(); accept(); finish()
      assert(not float(), "A sent prompt closes the modal")
      vim.cmd.BtwPrompt(); assert(text() == "")
      vim.cmd.BtwPrompt()
      queue.add(queue.project(), "Original project pending")
      vim.cmd.cd(${JSON.stringify(join(temp, "other"))})
      vim.cmd.enew()
      sent = nil
      send(); assert(sent == nil, "An empty project prompt must not send another project's draft")
      queue.add(queue.project(), "Other project pending")
      vim.cmd.BtwSendRequest(); assert(sent == "Other project pending")
      accept(); finish()
      vim.cmd.BtwPrompt(); assert(text() == "", "Prompts are project-specific")
    `,
      temp,
    );
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("thread splits are read-only chats; BtwSendThread continues the open one", () => {
  const temp = mkdtempSync(join(tmpdir(), "pi-thread-test-"));
  mkdirSync(join(temp, "project", ".git"), { recursive: true });
  try {
    runLua(
      `
    require("pi_btw").setup()
    vim.cmd.cd(${JSON.stringify(join(temp, "project"))})
    local thread = { id = "btw-12345678", exchanges = {} }
    local source = { pane = "%7", socket = "/old/socket", label = "work:7.0" }
    local asked, late_callback, late_finished, prompts = {}, nil, nil, 0
    package.loaded["pi_btw.bridge"] = {
      send = function(_, accepted, finished) prompts = prompts + 1; accepted(); finished() end,
      ask = function(question, callback, id, finished, target)
        table.insert(asked, { question = question, id = id, target = target })
        if id then
          assert(id == thread.id and target == source)
          if question == "Late" then late_callback, late_finished = callback, finished; return end
        end
        table.insert(thread.exchanges, { question = question, answer = "Because.\\n" .. string.rep("More detail\\n", 80) })
        if finished then finished() end
        callback(vim.deepcopy(thread), source)
      end,
      open_thread = function(id, callback) assert(id == thread.id); callback(vim.deepcopy(thread), source) end,
    }
    local threads = require("pi_btw.threads")
    local queue = require("pi_btw.queue")
    local function text() return table.concat(vim.api.nvim_buf_get_lines(0, 0, -1, false), "\\n") end
    local code = vim.api.nvim_get_current_win()
    threads.ask("Why?\\n\\n/code.ts:4")
    assert(asked[1].id == nil, "A first question starts a new thread")
    assert(vim.bo.filetype == "markdown" and not vim.bo.modifiable)
    assert(vim.api.nvim_win_get_config(0).relative == "" and #vim.api.nvim_list_wins() == 2)
    assert(text():find("## You", 1, true) and text():find("## BTW", 1, true) and text():find("Because.", 1, true))
    assert(vim.api.nvim_win_get_cursor(0)[1] == vim.api.nvim_buf_line_count(0), "Latest answer is in view")
    -- Sending inside the thread continues it and clears the prompt.
    queue.add(queue.project(), "/code.ts:9\\nFollow up")
    vim.cmd.BtwSendThread()
    assert(#asked == 2 and asked[2].id == thread.id and asked[2].question == "/code.ts:9\\nFollow up")
    assert(#thread.exchanges == 2 and prompts == 0)
    vim.cmd.BtwPrompt(); assert(text() == "", "Accepted prompt is cleared"); vim.cmd.BtwPrompt()
    -- A request from the code window goes to Pi, not the thread.
    vim.api.nvim_set_current_win(code)
    queue.add(queue.project(), "Main request")
    vim.cmd.BtwSendRequest()
    assert(prompts == 1 and #asked == 2)
    -- BtwSendThread from code continues the visible thread; BtwAsk too.
    queue.add(queue.project(), "Thread request")
    vim.cmd.BtwSendThread()
    assert(#asked == 3 and asked[3].id == thread.id and asked[3].question == "Thread request")
    vim.cmd("BtwAsk Quick question")
    assert(#asked == 4 and asked[4].id == thread.id)
    -- BtwAsk inside the thread is a plain follow-up without a file reference.
    for _, win in ipairs(vim.api.nvim_list_wins()) do
      if vim.api.nvim_buf_get_name(vim.api.nvim_win_get_buf(win)):find("^btw://") then vim.api.nvim_set_current_win(win) end
    end
    assert(threads.current(), "Thread window must be current")
    vim.cmd("BtwAsk Inside")
    assert(asked[#asked].question == "Inside" and asked[#asked].id == thread.id)
    -- Late replies after closing never reopen the split.
    queue.add(queue.project(), "Late")
    vim.cmd.BtwSendThread()
    assert(text():find("Waiting for Pi", 1, true))
    vim.cmd.close()
    local count = #vim.api.nvim_list_wins()
    late_finished(); late_callback(vim.deepcopy(thread))
    assert(#vim.api.nvim_list_wins() == count, "Late replies must not reopen closed splits")
    -- With no thread open, BtwSendThread starts a new one.
    queue.add(queue.project(), "Fresh")
    vim.cmd.BtwSendThread()
    assert(asked[#asked].id == nil and asked[#asked].question == "Fresh")
    assert(#vim.api.nvim_list_wins() == count + 1)
    -- An explicit ID opens that thread first.
    vim.cmd.close()
    queue.add(queue.project(), "By ID")
    vim.cmd("BtwSendThread " .. thread.id)
    assert(asked[#asked].id == thread.id and asked[#asked].question == "By ID")
    -- Same ID at another Pi must have a separate buffer.
    threads.show(thread, { pane = "%8", socket = "/new/socket", label = "other" })
    assert(#vim.fn.getbufinfo() >= 3)
  `,
      temp,
    );
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("the thread picker lists Pi's threads newest first and opens the choice in a split", () => {
  runLua(`
    local source = { pane = "%7", socket = "/socket", label = "work:7.0" }
    require("pi_btw").setup()
    local opened, shown = 0, nil
    package.loaded["pi_btw.bridge"] = {
      list_threads = function(callback)
        callback({ { id = "btw-11111111", question = "Older?" }, { id = "btw-22222222", question = "Newer?\\n\\n/x.lua:1" } }, source)
      end,
      open_thread = function(id, callback, target)
        assert(target == source)
        opened = opened + 1
        callback({ id = id, exchanges = { { question = "Why?", answer = "Because." } } }, source)
      end,
    }
    vim.ui.select = function(items, options, callback)
      shown = vim.tbl_map(options.format_item, items)
      callback(items[1])
    end
    vim.cmd.BtwThreads()
    assert(shown[1] == "btw-22222222  Newer?" and shown[2] == "btw-11111111  Older?", vim.inspect(shown))
    assert(opened == 1)
    assert(vim.bo.filetype == "markdown" and vim.api.nvim_win_get_config(0).relative == "")
    assert(table.concat(vim.api.nvim_buf_get_lines(0, 0, -1, false), "\\n"):find("Because.", 1, true))
    vim.cmd.BtwThreads()
    assert(opened == 2 and #vim.api.nvim_list_wins() == 2, "Reopening reuses the split")
    package.loaded["pi_btw.bridge"].list_threads = function(callback) callback({}, source) end
    local notice
    vim.notify = function(message) notice = message end
    vim.cmd.BtwThreads()
    assert(notice:find("No BTW threads", 1, true))
  `);
});

test("annotations carry file, range, and netrw references and respect each command's target", () => {
  const temp = mkdtempSync(join(tmpdir(), "pi-reference-test-"));
  mkdirSync(join(temp, "folder"));
  writeFileSync(join(temp, "a file.lua"), "one\ntwo\nthree\n");
  try {
    runLua(
      `
      require("pi_btw").setup()
      local queued, question, requested
      package.loaded["pi_btw.queue"] = {
        project = function() return "project" end,
        add = function(project, message) assert(project == "project"); queued = message end,
      }
      package.loaded["pi_btw.threads"] = {
        active = function() return nil end,
        ask = function(message, state) assert(state == nil); question = message end,
      }
      package.loaded["pi_btw.bridge"] = { send = function(message) requested = message end }
      local answer = "Please review"
      vim.ui.input = function(_, callback) callback(answer) end
      vim.cmd.edit(${JSON.stringify(join(temp, "a file.lua"))})
      vim.api.nvim_win_set_cursor(0, { 2, 0 })
      vim.cmd.BtwNote()
      assert(queued == ${JSON.stringify(join(temp, "a file.lua"))} .. ":2\\nPlease review", queued)
      answer = ""
      vim.cmd.BtwNote()
      assert(queued == ${JSON.stringify(join(temp, "a file.lua"))} .. ":2", "An empty note keeps the reference")
      answer = nil
      queued = nil
      vim.cmd.BtwNote()
      assert(queued == nil, "Cancelling adds nothing")
      vim.cmd("1,3BtwNote Review range")
      assert(queued:find("a file.lua:1-3\\nReview range", 1, true))
      vim.cmd("1,3BtwAsk Why this?")
      assert(question:find("a file.lua:1-3\\nWhy this?", 1, true))
      vim.cmd("2BtwRequest Do this")
      assert(requested:find("a file.lua:2\\nDo this", 1, true))
      vim.cmd.enew()
      vim.api.nvim_buf_set_name(0, ${JSON.stringify(temp)})
      vim.bo.filetype = "netrw"
      vim.b.netrw_curdir = ${JSON.stringify(temp)}
      vim.b.netrw_liststyle = 0
      vim.api.nvim_buf_set_lines(0, 0, -1, false, { "a file.lua", "folder/" })
      vim.cmd("1,2BtwNote Please review")
      assert(queued:find("File: " .. ${JSON.stringify(join(temp, "a file.lua"))}, 1, true))
      assert(queued:find("Folder: " .. ${JSON.stringify(join(temp, "folder"))}, 1, true))
      -- Scratch buffers add plain text without a reference.
      vim.cmd.enew()
      vim.bo.buftype = "nofile"
      queued = nil
      vim.cmd("BtwNote Plain text")
      assert(queued == "Plain text", queued)
      answer = ""
      vim.cmd.BtwNote()
      assert(queued == "Plain text", "Empty text in a scratch buffer adds nothing")
    `,
      temp,
    );
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
