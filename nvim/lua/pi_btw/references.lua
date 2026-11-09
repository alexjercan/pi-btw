local M = {}

local function netrw_locations(first, last)
  if (vim.b.netrw_liststyle or vim.w.netrw_liststyle or vim.g.netrw_liststyle or 0) ~= 0 then
    vim.notify("Use netrw thin listing (i) for Pi file comments", vim.log.levels.WARN)
    return
  end
  local directory = vim.b.netrw_curdir
  if not directory or directory:match("^%a+://") then
    vim.notify("Pi comments require a local netrw directory", vim.log.levels.WARN)
    return
  end
  local locations = {}
  for _, line in ipairs(vim.api.nvim_buf_get_lines(0, first - 1, last, false)) do
    if line ~= "" and not line:match('^"') then
      local entry = line:gsub("\t %-%->.*$", ""):gsub("[@*]$", "")
      local path = vim.fs.normalize(directory .. "/" .. entry)
      if vim.uv.fs_stat(path) then
        table.insert(locations, (vim.fn.isdirectory(path) == 1 and "Folder: " or "File: ") .. path)
      end
    end
  end
  if #locations == 0 then
    vim.notify("No files or folders selected", vim.log.levels.WARN)
    return
  end
  return table.concat(locations, "\n")
end

local function prompt_pi(visual, btw, options)
  options = options or {}
  local name = vim.api.nvim_buf_get_name(0)
  if name == "" then
    vim.notify("No filename to copy", vim.log.levels.WARN)
    return
  end

  local path = vim.fn.fnamemodify(name, ":.")
  local first = vim.fn.line(".")
  local last = first
  if visual then
    last = vim.fn.line("v")
    first, last = math.min(first, last), math.max(first, last)
  end

  first = options.line1 or first
  last = options.line2 or last
  visual = visual or options.range and options.range > 0
  local location
  local reference
  if vim.bo.filetype == "netrw" then
    location = netrw_locations(first, last)
    if not location then
      return
    end
    reference = "Files/folders: " .. (last - first + 1)
  else
    location = name .. ":" .. first .. (visual and ("-" .. last) or "")
    reference = path .. ":" .. first .. (visual and ("-" .. last) or "")
  end
  local project = require("pi_btw.queue").project()
  local function submit(text)
    if not text then
      return
    end
    text = vim.trim(text)
    if text == "" then
      return
    end
    local message = text .. "\n\n" .. location
    if btw then
      require("pi_btw.threads").ask(message)
    else
      require("pi_btw.queue").add(project, message)
    end
  end

  if options.args and options.args ~= "" then
    submit(options.args)
  else
    vim.ui.input({ prompt = (btw and "BTW: " or "Queue: ") .. reference .. ": " }, submit)
  end
end

function M.comment(visual, options)
  prompt_pi(visual, false, options)
end

function M.ask(visual, options)
  prompt_pi(visual, true, options)
end

return M
