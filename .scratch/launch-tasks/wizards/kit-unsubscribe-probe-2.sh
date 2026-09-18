#!/usr/bin/env bash
#
# Probe 2: the read-backs probe 1 lost to an unencoded '+' in the query string.
# Reads the subscriber probe 1 left behind (cancelled), three ways.
#
#   bash .scratch/launch-tasks/wizards/kit-unsubscribe-probe-2.sh

set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
RAW_DIR=".scratch/launch-tasks/kit-unsubscribe-probe-raw"
mkdir -p "$RAW_DIR"

BOLD=$(tput bold 2>/dev/null || true); DIM=$(tput dim 2>/dev/null || true)
RESET=$(tput sgr0 2>/dev/null || true); BLUE=$(tput setaf 4 2>/dev/null || true)

SUB_ID="4301207880"
DEFAULT_EMAIL="larsen.ideas+test2@gmail.com"

printf '\n%s  Kit probe 2 — the read-backs%s\n\n' "$BOLD$BLUE" "$RESET"
read -r -s -p "  Paste the Kit v4 API key: " KIT_API_KEY; echo
[[ -n "${KIT_API_KEY:-}" ]] || { echo "  no key entered"; exit 1; }
read -r -p "  Address probe 1 used [$DEFAULT_EMAIL]: " EMAIL
EMAIL="${EMAIL:-$DEFAULT_EMAIL}"

# This is the whole point: percent-encode the address before it goes in a query
# string, or '+' arrives at Kit as a space.
ENC=$(printf '%s' "$EMAIL" | python3 -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.stdin.read().strip(), safe=""))')
printf '  %sencoded as: %s%s\n' "$DIM" "$ENC" "$RESET"

call() {
  local name="$1" path="$2"
  LAST_STATUS=$(curl -sS -o "$RAW_DIR/$name.json" -w '%{http_code}' \
    -H "Accept: application/json" -H "X-Kit-Api-Key: $KIT_API_KEY" \
    "https://api.kit.com$path" || echo 000)
  printf '\n%s▸ %-26s%s → %s%s%s\n' "$BOLD$BLUE" "$name" "$RESET" "$BOLD" "$LAST_STATUS" "$RESET"
  if command -v jq >/dev/null 2>&1; then jq -C '.' < "$RAW_DIR/$name.json" | head -30; else cat "$RAW_DIR/$name.json"; fi
}

call 13-get-encoded-status-all "/v4/subscribers?email_address=$ENC&status=all"
call 14-get-encoded-default    "/v4/subscribers?email_address=$ENC"
call 15-get-by-id              "/v4/subscribers/$SUB_ID"

unset KIT_API_KEY
printf '\n%s  Done — raw responses in %s/%s\n\n' "$BOLD" "$RAW_DIR" "$RESET"
printf '%s  Still to clean up by hand in the Kit app: %s%s\n\n' "$DIM" "$EMAIL" "$RESET"
