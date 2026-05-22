# Dotfiles

## Install chezmoi
```
sh -c "$(curl -fsLS https://get.chezmoi.io)"
sudo mv bin/chezmoi /usr/local/bin/
```

## Clone to a new machine
```
chezmoi init --apply jon23d
```

## Add / update a file

1. Edit the file on a host with chezmoi
2. `chezmoi add path/to/file_or_folder`
3. `chezmoi cd`
4. commit / push
