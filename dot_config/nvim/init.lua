-- Check if Neovim is running on a remote server over SSH
if vim.env.SSH_TTY ~= nil then
  -- Force clean OSC 52 for headless SSH/Docker sessions
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
  -- Locally on macOS (or a Linux desktop), leave vim.g.clipboard unset.
  -- Neovim will automatically pick pbcopy/pbpaste or xclip instantly.
  vim.g.clipboard = nil
end

-- Map standard yanks and pastes to the active clipboard provider
vim.opt.clipboard = "unnamedplus"

-- Bootstrap lazy.nvim
local lazypath = vim.fn.stdpath("data") .. "/lazy/lazy.nvim"
if not vim.loop.fs_stat(lazypath) then
  vim.fn.system({
    "git",
    "clone",
    "--filter=blob:none",
    "https://github.com/folke/lazy.nvim.git",
    "--branch=stable", -- latest stable release
    lazypath,
  })
end
vim.opt.rtp:prepend(lazypath)

require("lazy").setup({
  -- 1. Syntax Highlighting (Makes code colorful)
  {
    "nvim-treesitter/nvim-treesitter",
    build = ":TSUpdate",
    config = function()
      require("nvim-treesitter.configs").setup({
        ensure_installed = { "lua", "python", "html", "css" }, -- Add languages you use
        highlight = { enable = true },
        indent = { enable = true },
      })
    end,
  },

  -- 2. Telescope (The best file finder)
  {
    "nvim-telescope/telescope.nvim",
    dependencies = { "nvim-lua/plenary.nvim" },
    config = function()
      local builtin = require('telescope.builtin')
      -- Map Ctrl+p to find files
      vim.keymap.set('n', '<leader>p', builtin.find_files, {})
    end,
  },

  -- 3. Which-Key (Shows you available shortcuts)
  {
    "folke/which-key.nvim",
    event = "VeryLazy",
    init = function()
      vim.o.timeout = true
      vim.o.timeoutlen = 500
    end,
    opts = {
      -- Your settings here
    }
  },

  -- 4. LSP Config (Makes Neovim smart/autocomplete)
  -- UPDATED FOR NEOVIM 0.11+
  {
    "neovim/nvim-lspconfig",
    config = function()
      -- Use the new vim.lsp.config syntax
      vim.lsp.config("lua_ls", {})
    end,
  },
  
  -- 5. Lualine (A pretty status bar at the bottom)
  {
    "nvim-lualine/lualine.nvim",
    dependencies = { "nvim-tree/nvim-web-devicons" },
    config = function()
      require("lualine").setup({})
    end,
  },
})

vim.opt.number = true          -- Show line numbers
vim.opt.relativenumber = true  -- Show relative line numbers
vim.opt.tabstop = 4            -- Number of spaces a tab counts for
vim.opt.shiftwidth = 4         -- Size of an indent
vim.opt.expandtab = true       -- Use spaces instead of tabs
vim.opt.smartcase = true       -- Case-sensitive search if it contains uppercase
vim.opt.ignorecase = true      -- Case-insensitive search
vim.opt.termguicolors = true   -- Enable 24-bit RGB colors
vim.opt.scrolloff = 999
vim.opt.splitbelow = true
vim.opt.splitright = true

