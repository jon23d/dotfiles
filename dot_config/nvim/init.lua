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

-- Specify your plugins in a separate folder or directly here
require("lazy").setup({
  "folke/tokyonight.nvim",
  {
    "nvim-telescope/telescope.nvim",
    dependencies = { "nvim-lua/plenary.nvim" }
  }
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

