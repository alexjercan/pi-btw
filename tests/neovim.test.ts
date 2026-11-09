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
    for _, name in ipairs({ "BtwAsk", "BtwComment", "BtwQueue", "BtwOpen", "PiBtw", "BtwSend", "BtwFollowup", "BtwConnect", "BtwList", "BtwStatus", "BtwThreads" }) do
      assert(vim.fn.exists(":" .. name) == 2, name)
    end
    for _, mode in ipairs({ "n", "x" }) do
      for _, key in ipairs({ "n", "b", "q", "f" }) do assert(vim.fn.maparg(" " .. key, mode) == "") end
    end
    vim.cmd.BtwQueue()
    assert(vim.api.nvim_win_get_config(0).relative == "")
    assert(#vim.api.nvim_list_wins() == 2)
    assert(#vim.api.nvim_buf_get_keymap(0, "n") == 0)
  `);
});

test("thread split supports commands, source-pinned follow-ups, promotion, and late replies", () => {
  runLua(`
    local thread = { id = "btw-12345678", exchanges = {} }
    local source = { pane = "%7", socket = "/old/socket", label = "work:7.0" }
    local promoted, late_callback, late_finished = 0
    require("pi_btw").setup()
    package.loaded["pi_btw.bridge"] = {
      ask = function(question, callback, id, finished, target)
        if id then
          assert(id == thread.id and target == source)
          if question == "Late" then late_callback, late_finished = callback, finished; return end
        end
        table.insert(thread.exchanges, { question = question, answer = "Because.\\n" .. string.rep("More detail\\n", 80) })
        if finished then finished() end
        callback(vim.deepcopy(thread), source)
      end,
      promote = function(id, accepted, finished, target)
        assert(id == thread.id and target == source)
        promoted = promoted + 1; accepted(); finished()
      end,
      open_thread = function(id, callback) assert(id == thread.id); callback(vim.deepcopy(thread), source) end,
    }
    local btw = require("pi_btw.threads")
    btw.ask("Why?\\n\\n/code.ts:4")
    local function text() return table.concat(vim.api.nvim_buf_get_lines(0, 0, -1, false), "\\n") end
    assert(vim.bo.filetype == "markdown" and not vim.bo.modifiable)
    assert(vim.api.nvim_win_get_config(0).relative == "")
    assert(text():find("Because.", 1, true))
    vim.cmd("BtwFollowup Follow up")
    assert(#thread.exchanges == 2)
    vim.cmd.BtwSend(); vim.cmd.BtwSend()
    assert(promoted == 1)
    assert(text():find("Sent to the main agent", 1, true))
    assert(vim.api.nvim_buf_line_count(0) > vim.api.nvim_win_get_height(0))
    vim.cmd.close()
    vim.cmd("BtwOpen " .. thread.id)
    assert(text():find("Follow up", 1, true))
    vim.cmd("BtwFollowup Late")
    vim.cmd.close()
    local count = #vim.api.nvim_list_wins()
    late_finished(); late_callback(vim.deepcopy(thread))
    assert(#vim.api.nvim_list_wins() == count, "Late replies must not reopen closed splits")
    -- Same ID at another Pi must have a separate buffer.
    btw.show(thread, { pane = "%8", socket = "/new/socket", label = "other" })
    assert(#vim.fn.getbufinfo() >= 3)
  `);
});

test("quickfix lists source-pinned threads and native navigation loads their buffers", () => {
  runLua(`
    local source = { pane = "%7", socket = "/socket", label = "work:7.0" }
    require("pi_btw").setup()
    local opened = 0
    package.loaded["pi_btw.bridge"] = {
      list_threads = function(callback) callback({ { id = "btw-12345678", question = "Why?" } }, source) end,
      open_thread = function(id, callback, target)
        assert(target == source)
        opened = opened + 1
        callback({ id = id, exchanges = { { question = "Why?", answer = "Because." } } })
      end,
    }
    vim.cmd.BtwThreads()
    assert(vim.bo.buftype == "quickfix")
    assert(vim.fn.getqflist()[1].text == "btw-12345678 Why?")
    vim.cmd.cfirst()
    assert(opened == 1)
    assert(vim.bo.filetype == "markdown")
    assert(table.concat(vim.api.nvim_buf_get_lines(0, 0, -1, false), "\\n"):find("Because.", 1, true))
    vim.cmd.BtwThreads()
    vim.cmd.cfirst()
    assert(opened == 2)
  `);
});

test("editable project queue persists, batches, and retains failed or edited drafts", () => {
  const temp = mkdtempSync(join(tmpdir(), "pi-queue-test-"));
  mkdirSync(join(temp, "project", ".git"), { recursive: true });
  mkdirSync(join(temp, "other"));
  const setup = `
    require("pi_btw").setup()
    vim.cmd.cd(${JSON.stringify(join(temp, "project"))})
    local sent, accept, finish
    package.loaded["pi_btw.bridge"] = { send = function(message, accepted, finished)
      sent, accept, finish = message, accepted, finished
    end }
    local queue = require("pi_btw.queue")
    local function send() vim.cmd.BtwSend() end
    local function text() return table.concat(vim.api.nvim_buf_get_lines(0, 0, -1, false), "\\n") end
  `;
  try {
    runLua(
      setup +
        `
      queue.add(queue.project(), "First comment\\n\\n/tmp/a.lua:3-5")
      queue.add(queue.project(), "Second comment\\n\\nFolder: /tmp/src")
      vim.cmd.BtwQueue()
      assert(text():find("Second comment", 1, true))
      vim.api.nvim_buf_set_lines(0, 0, 1, false, { "Edited comment" })
    `,
      temp,
    );
    runLua(
      setup +
        `
      local current, windows = vim.api.nvim_get_current_buf(), #vim.api.nvim_list_wins()
      send()
      assert(sent:find("Edited comment", 1, true), "Send must load the saved queue without opening it")
      assert(vim.api.nvim_get_current_buf() == current and #vim.api.nvim_list_wins() == windows)
      local first_send = accept
      send(); assert(accept == first_send, "Do not send the queue twice while busy")
      finish() -- failed send must retain the draft
      vim.cmd.BtwQueue()
      assert(text():find("Edited comment", 1, true), "Draft did not survive restart")
      local draft = text()
      send(); assert(sent == draft); finish()
      assert(text() == draft)
      send(); queue.add(queue.project(), "Appended while sending"); accept(); finish()
      assert(not text():find("Edited comment", 1, true))
      assert(text():find("Appended while sending", 1, true))
      send(); vim.api.nvim_buf_set_lines(0, 0, -1, false, { "Changed during send" }); accept(); finish()
      assert(text() == "Changed during send")
      send(); accept(); finish(); assert(text() == "")
      queue.add(queue.project(), "Original project pending")
      vim.cmd.cd(${JSON.stringify(join(temp, "other"))})
      vim.cmd.enew()
      sent = nil
      send(); assert(sent == nil, "An empty project queue must not send another project's draft")
      queue.add(queue.project(), "Other project pending")
      send(); assert(sent == "Other project pending")
      accept(); finish()
      vim.cmd.BtwQueue(); assert(text() == "", "Queues must be project-specific")
    `,
      temp,
    );
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("command arguments and ranges preserve file and netrw references without sending comments", () => {
  const temp = mkdtempSync(join(tmpdir(), "pi-reference-test-"));
  mkdirSync(join(temp, "folder"));
  writeFileSync(join(temp, "a file.lua"), "one\ntwo\nthree\n");
  try {
    runLua(
      `
      require("pi_btw").setup()
      local queued, question
      package.loaded["pi_btw.queue"] = {
        project = function() return "project" end,
        add = function(project, message) assert(project == "project"); queued = message end,
      }
      package.loaded["pi_btw.bridge"] = nil
      package.preload["pi_btw.bridge"] = function() error("Comments must not contact Pi directly") end
      package.loaded["pi_btw.threads"] = { ask = function(message) question = message end }
      vim.ui.input = function(_, callback) callback("Please review") end
      vim.cmd.edit(${JSON.stringify(join(temp, "a file.lua"))})
      vim.api.nvim_win_set_cursor(0, { 2, 0 })
      vim.cmd.BtwComment()
      assert(queued:find("a file.lua:2", 1, true))
      vim.cmd("1,3BtwComment Review range")
      assert(queued:find("Review range", 1, true) and queued:find("a file.lua:1-3", 1, true))
      vim.cmd("1,3BtwAsk Why this?")
      assert(question:find("Why this?", 1, true) and question:find("a file.lua:1-3", 1, true))
      vim.cmd.enew()
      vim.api.nvim_buf_set_name(0, ${JSON.stringify(temp)})
      vim.bo.filetype = "netrw"
      vim.b.netrw_curdir = ${JSON.stringify(temp)}
      vim.b.netrw_liststyle = 0
      vim.api.nvim_buf_set_lines(0, 0, -1, false, { "a file.lua", "folder/" })
      vim.cmd("1,2BtwComment Please review")
      assert(queued:find("File: " .. ${JSON.stringify(join(temp, "a file.lua"))}, 1, true))
      assert(queued:find("Folder: " .. ${JSON.stringify(join(temp, "folder"))}, 1, true))
    `,
      temp,
    );
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
