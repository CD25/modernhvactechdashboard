#!/usr/bin/env sh
# Secure https:// link for phones and laptops anywhere. Keep it running.
command -v cloudflared >/dev/null 2>&1 || { echo "Install cloudflared: brew install cloudflared (Mac) or see https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"; exit 1; }
exec cloudflared tunnel --url http://localhost:8080
