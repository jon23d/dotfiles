#!/usr/bin/env bash

# Only meaningful on Linux (VMs); on macOS there's no LAN IP we care about
# for the status bar.
if [ "$(uname -s)" != "Linux" ]; then
	exit 0
fi

# Prefer the homelab LAN (192.168.50.0/23 -- see the DNS/netmask incident
# notes) so this resolves to the same kind of address across machines that
# may also have other interfaces (VPN, docker bridges, ...) up.
IP=$(ip -4 -o addr show scope global 2>/dev/null \
	| awk '{print $4}' | cut -d/ -f1 \
	| grep -E '^192\.168\.(50|51)\.' | head -1)

# Fall back to the first non-container global IPv4 on machines without that
# subnet.
if [ -z "$IP" ]; then
	IP=$(ip -4 -o addr show scope global 2>/dev/null \
		| grep -vE 'docker0|br-|veth|virbr' \
		| awk '{print $4}' | cut -d/ -f1 | head -1)
fi

echo "(${IP:-unknown}) "
