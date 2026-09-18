#!/usr/bin/env bash
#
# Probe: what does Kit v4 actually do to a *cancelled* subscriber?
# Resolves the factual half of wayfinder ticket #15.
#
# You drive it; it never writes your API key to disk. Every raw response is
# saved under .scratch/launch-tasks/kit-unsubscribe-probe-raw/ for the agent
# to read back.
#
# Run from the repo root:  bash .scratch/launch-tasks/wizards/kit-unsubscribe-probe.sh

set -uo pipefail

RAW_DIR=".scratch/launch-tasks/kit-unsubscribe-probe-raw"
mkdir -p "$RAW_DIR"

if [[ -t 1 ]] && command -v tput >/dev/null 2>&1; then
  BOLD=$(tput bold); DIM=$(tput dim); RESET=$(tput sgr0)
  BLUE=$(tput setaf 4); GREEN=$(tput setaf 2); YELLOW=$(tput setaf 3); RED=$(tput setaf 1)
else
  BOLD=""; DIM=""; RESET=""; BLUE=""; GREEN=""; YELLOW=""; RED=""
fi

say()  { printf '  %s\n' "$1"; }
head_() { printf '\n%s%s▸ %s%s\n' "$BOLD" "$BLUE" "$1" "$RESET"; }
ok()   { printf '  %s✓ %s%s\n' "$GREEN" "$1" "$RESET"; }
warn() { printf '  %s! %s%s\n' "$YELLOW" "$1" "$RESET"; }
die()  { printf '  %s✗ %s%s\n' "$RED" "$1" "$RESET"; exit 1; }

TAG_ID="23720088"          # launch-tasks-signup (from #14)
FIELD_KEY="practice_state" # custom field key (from #14)

printf '\n%s  Kit unsubscribe probe%s\n' "$BOLD$BLUE" "$RESET"
printf '%s  Creates one throwaway subscriber, unsubscribes it, then tries every\n' "$DIM"
printf '  write path against it. ~10 API calls, well inside the 120/min limit.\n'
printf '  Your key is read into memory only — never echoed, never saved.%s\n\n' "$RESET"

read -r -s -p "  Paste the Kit v4 API key: " KIT_API_KEY; echo
[[ -n "${KIT_API_KEY:-}" ]] || die "no key entered"

DEFAULT_EMAIL="admin+ltprobe$(date +%s)@directcaretools.com"
read -r -p "  Throwaway address [$DEFAULT_EMAIL]: " EMAIL
EMAIL="${EMAIL:-$DEFAULT_EMAIL}"
say "using $EMAIL"

# call <name> <METHOD> <path> [json-body]
# Saves body to $RAW_DIR/<name>.json, prints the status, exports LAST_STATUS/LAST_BODY.
call() {
  local name="$1" method="$2" path="$3" body="${4:-}"
  local out="$RAW_DIR/$name.json" args=()
  args=(-sS -o "$out" -w '%{http_code}' -X "$method"
        -H "Accept: application/json"
        -H "X-Kit-Api-Key: $KIT_API_KEY")
  if [[ -n "$body" ]]; then
    args+=(-H "Content-Type: application/json" -d "$body")
  fi
  LAST_STATUS=$(curl "${args[@]}" "https://api.kit.com$path" || echo "000")
  LAST_BODY=$(cat "$out" 2>/dev/null)
  printf '  %s%-28s %s %s%s  → %s%s\n' "$DIM" "$name" "$method" "$path" "$RESET" "$BOLD$LAST_STATUS" "$RESET"
}

jqf() { command -v jq >/dev/null 2>&1 && printf '%s' "$LAST_BODY" | jq -r "$1" 2>/dev/null || printf '?'; }

# ── 1. create, tagged, with the custom field set ─────────────────────────
head_ "1/9  Create the subscriber (with $FIELD_KEY=TX)"
call 01-create POST /v4/subscribers \
  "{\"email_address\":\"$EMAIL\",\"first_name\":\"Probe\",\"fields\":{\"$FIELD_KEY\":\"TX\"}}"
SUB_ID=$(jqf '.subscriber.id')
say "subscriber id: $SUB_ID   state: $(jqf '.subscriber.state')   $FIELD_KEY: $(jqf ".subscriber.fields.\"$FIELD_KEY\"")"
say "warnings: $(jqf '.warnings // [] | tostring')"
[[ "$SUB_ID" =~ ^[0-9]+$ ]] || die "no subscriber id came back — stopping before we make a mess"

head_ "2/9  Tag it (launch-tasks-signup)"
call 02-tag POST "/v4/tags/$TAG_ID/subscribers" "{\"email_address\":\"$EMAIL\"}"

# ── 2. unsubscribe ───────────────────────────────────────────────────────
head_ "3/9  Unsubscribe it (the consent-revoking act)"
call 03-unsubscribe POST "/v4/subscribers/$SUB_ID/unsubscribe"
[[ "$LAST_STATUS" == "204" || "$LAST_STATUS" == "200" ]] || warn "unexpected status; read $RAW_DIR/03-unsubscribe.json"

head_ "4/9  Read it back — does it still exist? is the tag retained?"
call 04-get-status-all GET "/v4/subscribers?email_address=$EMAIL&status=all"
say "state now: $(jqf '.subscribers[0].state')   $FIELD_KEY: $(jqf ".subscribers[0].fields.\"$FIELD_KEY\"")"
call 05-get-default-status GET "/v4/subscribers?email_address=$EMAIL"
say "visible without status=all? matches: $(jqf '.subscribers | length')  ${DIM}(0 = the trap is real)${RESET}"

# ── 3. the three write paths against a cancelled subscriber ──────────────
head_ "5/9  Re-POST the same address (what naive re-registration does)"
call 06-recreate POST /v4/subscribers \
  "{\"email_address\":\"$EMAIL\",\"first_name\":\"ProbeTwo\",\"fields\":{\"$FIELD_KEY\":\"CA\"}}"
say "returned state: $(jqf '.subscriber.state')   $FIELD_KEY: $(jqf ".subscriber.fields.\"$FIELD_KEY\"")"
say "warnings: $(jqf '.warnings // [] | tostring')"

head_ "6/9  Read back — did the re-POST resurrect them or write the field?"
call 07-get-after-recreate GET "/v4/subscribers?email_address=$EMAIL&status=all"
say "state: $(jqf '.subscribers[0].state')   first_name: $(jqf '.subscribers[0].first_name')   $FIELD_KEY: $(jqf ".subscribers[0].fields.\"$FIELD_KEY\"")"

head_ "7/9  PUT the custom field on a cancelled subscriber (#13's update path)"
call 08-put-field PUT "/v4/subscribers/$SUB_ID" \
  "{\"fields\":{\"$FIELD_KEY\":\"NV\"}}"
say "returned state: $(jqf '.subscriber.state')   $FIELD_KEY: $(jqf ".subscriber.fields.\"$FIELD_KEY\"")"
call 09-get-after-put GET "/v4/subscribers?email_address=$EMAIL&status=all"
say "state: $(jqf '.subscribers[0].state')   $FIELD_KEY: $(jqf ".subscribers[0].fields.\"$FIELD_KEY\"")"

head_ "8/9  Re-tag a cancelled subscriber (does tagging resurrect?)"
call 10-retag POST "/v4/tags/$TAG_ID/subscribers" "{\"email_address\":\"$EMAIL\"}"
call 11-get-final GET "/v4/subscribers?email_address=$EMAIL&status=all"
say "final state: $(jqf '.subscribers[0].state')"

head_ "9/9  Do forms exist on this plan? (the only legitimate resubscribe path)"
call 12-forms GET "/v4/forms"
say "forms found: $(jqf '.forms | length')"
if command -v jq >/dev/null 2>&1; then
  printf '%s' "$LAST_BODY" | jq -r '.forms[]? | "    \(.id)  \(.name)  [\(.format)]  \(.url // "no url")"' 2>/dev/null
fi
say "${DIM}0 forms is fine — it means none exist yet, not that the plan lacks them.${RESET}"
say "${DIM}A 403/404 here is the real signal: forms gated off this plan.${RESET}"

unset KIT_API_KEY

printf '\n%s  Done. Raw responses in %s/%s\n' "$BOLD$GREEN" "$RAW_DIR" "$RESET"
printf '%s  Cleanup: v4 has no delete-subscriber endpoint, so remove %s\n' "$DIM" "$EMAIL"
printf '  by hand in the Kit app (Subscribers → search the address → Delete),\n'
printf '  exactly as the #14 probe was cleaned up.%s\n\n' "$RESET"
