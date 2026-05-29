-- Modify leader
vim.g.mapleader = " "

-- =============================================================================
-- CLIPBOARD
-- =============================================================================
if vim.env.SSH_TTY ~= nil then
  vim.g.clipboard = {
    name = 'OSC 52 Native',
    copy = {
      ['+'] = require('vim.ui.clipboard.osc52').copy('+'),
      ['*'] = require('vim.ui.clipboard.osc52').copy('*'),
    },
    paste = {
      ['+'] = require('vim.ui.clipboard.osc52').paste('+'),
      ['*'] = require('vim.ui.clipboard.osc52').paste('*'),
    },
  }
else
  vim.g.clipboard = nil
end
vim.opt.clipboard = "unnamedplus"

-- =============================================================================
-- BOOTSTRAP LAZY.NVIM
-- =============================================================================
local lazypath = vim.fn.stdpath("data") .. "/lazy/lazy.nvim"
if not vim.uv.fs_stat(lazypath) then
  vim.fn.system({
    "git", "clone", "--filter=blob:none",
    "https://github.com/folke/lazy.nvim.git",
    "--branch=stable",
    lazypath,
  })
end
vim.opt.rtp:prepend(lazypath)

-- =============================================================================
-- PLUGINS
-- =============================================================================
require("lazy").setup({

  -- 1. Colorscheme (load first so everything looks right)
  {
    "folke/tokyonight.nvim",
    lazy = false,
    priority = 1000,
    config = function()
      vim.cmd("colorscheme tokyonight-night")
    end,
  },

  -- 2. Treesitter (syntax highlighting)
  {
    "nvim-treesitter/nvim-treesitter",
    build = ":TSUpdate",
    lazy = false,
    main = "nvim-treesitter.config",
    opts = {
      ensure_installed = { "lua", "python", "html", "css", "bash", "markdown" },
      auto_install = true,
      sync_install = false,
      highlight = { enable = true },
      indent = { enable = true },
    },
  },

  -- 3. Telescope (fuzzy file finder)
  {
    "nvim-telescope/telescope.nvim",
    dependencies = { "nvim-lua/plenary.nvim" },
    config = function()
      local builtin = require('telescope.builtin')
      vim.keymap.set('n', '<leader>p', builtin.find_files, { desc = "Find files" })
      vim.keymap.set('n', '<leader>fg', builtin.live_grep,  { desc = "Live grep" })
      vim.keymap.set('n', '<leader>fb', builtin.buffers,    { desc = "Find buffers" })
    end,
  },

  -- 4. Which-Key (shortcut hints)
  {
    "folke/which-key.nvim",
    event = "VeryLazy",
    init = function()
      vim.o.timeout = true
      vim.o.timeoutlen = 500
    end,
    opts = {},
  },

  -- 5. Lualine (status bar)
  {
    "nvim-lualine/lualine.nvim",
    dependencies = { "nvim-tree/nvim-web-devicons" },
    config = function()
      require("lualine").setup({ options = { theme = "tokyonight" } })
    end,
  },

  -- 6. Neo-tree (file explorer)
  {
    "nvim-neo-tree/neo-tree.nvim",
    dependencies = {
      "nvim-lua/plenary.nvim",
      "nvim-tree/nvim-web-devicons",
      "MunifTanjim/nui.nvim",
    },
    config = function()
      vim.keymap.set("n", "<leader>e", ":Neotree toggle<CR>", { desc = "Toggle file tree" })
      vim.keymap.set("n", "<leader>E", ":Neotree reveal<CR>", { desc = "Reveal file in tree" })
    end,
  },

  -- 7. Bufferline (show open buffers)
  {
    "akinsho/bufferline.nvim",
    dependencies = { "nvim-tree/nvim-web-devicons" },
    config = function()
      require("bufferline").setup({
        options = {
          offsets = {
            {
              filetype = "neo-tree",
              text = "File Explorer",
              highlight = "Directory",
              separator = true,
            },
          },
          -- DYNAMIC NAMING LOGIC STARTS HERE --
          name_formatter = function(buf)
            local is_markdown = vim.api.nvim_get_option_value('filetype', { buf = buf.bufnr }) == 'markdown'
            if is_markdown then
              if vim.api.nvim_buf_is_loaded(buf.bufnr) then
                local lines = vim.api.nvim_buf_get_lines(buf.bufnr, 0, 15, false)
                for _, line in ipairs(lines) do
                  local h1_title = line:match("^#%s+(.+)$")
                  if h1_title and h1_title ~= "" then
                    return h1_title
                  end
                end
                for _, line in ipairs(lines) do
                  local fm_title = line:match("^title:%s*(.+)$")
                  if fm_title and fm_title ~= "" then
                    return fm_title:gsub('["\']', '')
                  end
                end
              end
              local filename = vim.fs.basename(buf.path)
              return filename:gsub("%.md$", "")
            end
            return vim.fs.basename(buf.path)
          end,
          -- DYNAMIC NAMING LOGIC ENDS HERE --
        },
      })

      -- Navigate buffers like tabs
      vim.keymap.set("n", "<Tab>", ":BufferLineCycleNext<CR>", { desc = "Next buffer" })
      vim.keymap.set("n", "<S-Tab>", ":BufferLineCyclePrev<CR>", { desc = "Prev buffer" })
    end,
  },

  -- 8. Obsidian Nvim

  {
    "epwalsh/obsidian.nvim",
    version = "*",
    lazy = true,
    ft = "markdown",
    dependencies = {
      "nvim-lua/plenary.nvim",
      "nvim-telescope/telescope.nvim",
    },
    config = function()
      require("obsidian").setup({
        workspaces = {
          {
            name = "personal",
            path = "~/notes",
          },
        },
        picker = {
          name = "telescope.nvim",
        },
        daily_notes = {
          folder = "journal",
          date_format = "%Y-%m-%d",
          template = "daily_note.md",
        },
        templates = {
          folder = "templates", 
          date_format = "%Y-%m-%d",
          time_format = "%H:%M",
          substitutions = {
                ["date:YYYY-MM-DD"] = function()
                  return os.date("%Y-%m-%d")
                end,
                ["date:dddd, MMMM D, YYYY"] = function()
                  -- Returns Sunday, May 24, 2026 format
                  return os.date("%A, %B %d, %Y")
                end,
                ["time:HH:mm"] = function()
                  return os.date("%H:%M")
                end,
              },
        },
        follow_url_func = function(url)
          vim.fn.jobstart({"open", url})
        end,
        ui = {
          enable = true,
        },
      })
    end,
  },

  -- 9. Table Mode (markdown tables)
    {
      "dhruvasagar/vim-table-mode",
      ft = "markdown",
      config = function()
        -- Use | corner character for markdown-compatible tables
        vim.g.table_mode_corner = "|"
        -- Toggle with <leader>tm
        vim.keymap.set("n", "<leader>tm", ":TableModeToggle<CR>", { desc = "Toggle table mode" })
        -- Realign an existing table manually
        vim.keymap.set("n", "<leader>tr", ":TableModeRealign<CR>", { desc = "Realign table" })
      end,
    },

  -- 10. auto session (remember files opened on start)
  {
      "rmagatti/auto-session",
      lazy = false,

      ---enables autocomplete for opts
      ---@module "auto-session"
      ---@type AutoSession.Config
      opts = {
        suppressed_dirs = { "~/", "~/Projects", "~/Downloads", "/" },
        -- log_level = 'debug',
      },
    }
})

-- =============================================================================
-- OPTIONS
-- =============================================================================
vim.opt.number         = true   -- Absolute line number on current line
vim.opt.relativenumber = true   -- Relative numbers on all other lines
vim.opt.tabstop        = 4
vim.opt.shiftwidth     = 4
vim.opt.expandtab      = true
vim.opt.smartcase      = true
vim.opt.ignorecase     = true
vim.opt.termguicolors  = true
vim.opt.scrolloff      = 999    -- Keep cursor vertically centered
vim.opt.splitbelow     = true
vim.opt.splitright     = true
vim.opt.wrap           = false
vim.opt.swapfile       = false
vim.opt.undofile       = true   -- Persistent undo history across sessions
vim.opt.cursorline     = true
vim.opt.confirm        = true   -- Ask to save unsaved changes
vim.opt.linebreak      = true   -- When wrapping, break at word boundaries


-- Use a conceal level of 2 for obsidian
vim.api.nvim_create_autocmd("FileType", {
  pattern = "markdown",
  callback = function()
    vim.opt_local.conceallevel = 2  -- 1 or 2 both satisfy obsidian; 2 conceals more
  end,
  desc = "Set conceallevel for markdown (obsidian.nvim)",
})

-- Complete up to the longest common match, then show a menu of choices
vim.o.wildmode = "longest:full,full"

-- Display the command-line completion choices as a modern pop-up menu
vim.o.wildoptions = "pum"

-- Additional key maps
vim.keymap.set('n', '<leader>w', ':set wrap!<CR>', { desc = 'Toggle Wrap' })

-- Insert live timestamp insert mode with double ctrl+c
vim.keymap.set("i", "<C-c><C-c>", function()
  local time = os.date("%H:%M | ")
  vim.api.nvim_put({ time }, "c", true, true)
end, { desc = "Insert current timestamp" })

-- Delete without yanking
vim.keymap.set('n', 'D', '"_D', { desc = 'Delete to end of line without yanking' })
vim.keymap.set('n', 'dd', '"_dd', { desc = 'Delete line without yanking' })
vim.keymap.set('n', 'x', '"_x', { desc = 'Delete character without yanking' })



