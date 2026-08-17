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

## Neovim reuquirements
- node
- ripgrep

## Control-plane daemon

Runs coding-agent sessions (`opencode` today) on a VM under remote control
from a Mattermost DM. As of KAN-19 this daemon lives in its own repo,
[jon23d/chatty](https://github.com/jon23d/chatty) — see that repo's
`README.md` for the full operator's guide: installing/updating it, the
`start`/`stop`/`list`/`help` command surface, the environment/config model,
how to verify it's working, and troubleshooting.

This repo's role is now just to keep `~/code/chatty` cloned/updated and
delegate to its own install script — see
`run_onchange_install-chatty.sh.tmpl`.

## Secrets

Secrets are kept in a single file, `~/.config/secrets.env`, encrypted as one opaque
GPG blob in the repo (chezmoi names it something like `encrypted_dot_config/secrets.env.asc`).
Using one file instead of one-per-secret keeps variable/service names out of the
repo entirely — nothing about what secrets exist, or how many, is visible from
outside.

### Adding or updating a secret

1. Edit the plaintext file locally (create it if it doesn't exist yet):
   ```
   $EDITOR ~/.config/secrets.env
   ```
   Add lines like:
   ```
   export SOME_KEY="..."
   ```

2. Re-encrypt and re-add it to chezmoi's source state:
   ```
   chezmoi add --encrypt ~/.config/secrets.env
   ```
   (For quick edits after the first time, `chezmoi edit --apply ~/.config/secrets.env`
   does decrypt → open in `$EDITOR` → re-encrypt → apply in one step.)

3. Commit and push from chezmoi's source directory:
   ```
   chezmoi cd
   git add -A
   git commit -m "Update secrets"
   git push
   exit
   ```

4. Open a new terminal tab so the newly sourced variables take effect.

### Bootstrapping a new machine

Decryption requires the GPG private key to be present locally — there is no
automated way to deliver it (deliberately; see conversation history for why).
On a brand new machine:

1. Manually retrieve the private key from 1Password yourself and get it onto
   the machine (however you'd like — paste into a file, `multipass transfer`
   for VMs, etc.).
2. Import it and set trust:
   ```
   gpg --import key.asc
   gpg --edit-key <keyid>
   # at the gpg> prompt: trust, then 5 (ultimate), then quit
   ```
3. Delete the plaintext key file once imported.
4. Re-run `chezmoi init jon23d` (not just `apply`) so the encryption config in
   `.chezmoi.toml.tmpl` gets picked up.
5. `chezmoi apply` — this can now decrypt `secrets.env` along with everything else.
