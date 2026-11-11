-- Build annotations: a file reference for the cursor line, a visual selection,
-- or a command range, followed by the user's note.
local M = {}

local function netrw_locations(first, last)
  if (vim.b.netrw_liststyle or vim.w.netrw_liststyle or vim.g.netrw_liststyle or 0) ~= 0 then
    vim.notify("Use netrw thin listing (i) for BTW annotations", vim.log.levels.WARN)
    return
  end
  local directory = vim.b.netrw_curdir
  if not directory or directory:match("^%a+://") then
    vim.notify("BTW annotations require a local netrw directory", vim.log.levels.WARN)
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

-- Returns the reference block and a short label, or nil when the current
-- buffer is not a file. `false` means the user must be warned and stop.
local function reference(visual, options)
  local name = vim.api.nvim_buf_get_name(0)
  local first = vim.fn.line(".")
  local last = first
  if visual then
    last = vim.fn.line("v")
    first, last = math.min(first, last), math.max(first, last)
  end
  first = options.line1 or first
  last = options.line2 or last
  if vim.bo.filetype == "netrw" then
    local location = netrw_locations(first, last)
    if not location then
      return false
    end
    return location, "files/folders: " .. (last - first + 1)
  end
  if name == "" or vim.bo.buftype ~= "" then
    return nil
  end
  local span = first .. (last > first and ("-" .. last) or "")
  return name .. ":" .. span, vim.fn.fnamemodify(name, ":.") .. ":" .. span
end

-- Compose an annotation and hand it to `submit`. With no argument text the
-- note is asked for; an empty note keeps only the reference.
function M.capture(visual, options, label, submit)
  options = options or {}
  local location, short = reference(visual or false, options)
  if location == false then
    return
  end
  local function finish(text)
    if text == nil then
      return
    end
    text = vim.trim(text)
    if location then
      submit(text ~= "" and (location .. "\n" .. text) or location)
    elseif text ~= "" then
      submit(text)
    end
  end
  if options.args and options.args ~= "" then
    finish(options.args)
  else
    vim.ui.input({ prompt = label .. (short and (" " .. short) or "") .. ": " }, finish)
  end
end

return M
