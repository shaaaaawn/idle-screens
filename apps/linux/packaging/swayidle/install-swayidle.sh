#!/usr/bin/env bash
# Wire idle-screens into a swayidle-driven session (sway / labwc / wayfire /
# Raspberry Pi OS).
#
# swayidle has no config file — it is configured by its command line — so this
# script finds the launch site and rewrites the line there. There is only ONE
# swayidle process and it owns every timeout, so we extend the existing
# invocation rather than starting a second one.
#
# Note on ordering: swayidle evaluates each `timeout` independently, so where our
# arguments land in the list is cosmetic. What matters is that the saver timeout
# is numerically SMALLER than the display-blank timeout, or the panel powers off
# behind the running saver. We enforce that by raising the blank timeout when it
# is not already larger.
set -euo pipefail

SAVER_TIMEOUT="${SAVER_TIMEOUT:-150}"
BLANK_TIMEOUT="${BLANK_TIMEOUT:-900}"
KIOSK="${KIOSK:-}"

if ! command -v swayidle >/dev/null 2>&1; then
  echo "swayidle not found — this script is for sway/labwc/wayfire sessions." >&2
  echo "On Hyprland/Omarchy use ./packaging/omarchy/install-omarchy.sh instead." >&2
  exit 1
fi

if [ "$BLANK_TIMEOUT" -le "$SAVER_TIMEOUT" ]; then
  echo "BLANK_TIMEOUT ($BLANK_TIMEOUT) must be greater than SAVER_TIMEOUT ($SAVER_TIMEOUT)," >&2
  echo "or the display powers off while the saver is showing." >&2
  exit 1
fi

config_home="${XDG_CONFIG_HOME:-$HOME/.config}"

# Find the launch site. First match wins; override with SWAYIDLE_LAUNCH_FILE.
# A file under /etc/xdg is copied to the user override first — editing /etc is
# both wrong and temporary (a distro update reverts it).
find_launch_file() {
  local candidates=(
    "$config_home/labwc/autostart"
    "$config_home/sway/config"
    "$config_home/wayfire.ini"
    "$config_home/systemd/user/swayidle.service"
    "/etc/xdg/labwc/autostart"
    "/etc/xdg/autostart/swayidle.desktop"
  )
  local f
  for f in "${candidates[@]}"; do
    [ -f "$f" ] && grep -q 'swayidle' "$f" 2>/dev/null && { echo "$f"; return 0; }
  done
  return 1
}

launch_file="${SWAYIDLE_LAUNCH_FILE:-$(find_launch_file || true)}"

if [ -z "$launch_file" ]; then
  # No existing swayidle line anywhere — write a fresh one for labwc, the
  # Raspberry Pi OS / labwc default. Other sessions: see swayidle.snippet.
  launch_file="$config_home/labwc/autostart"
  echo "No existing swayidle invocation found; creating one in $launch_file"
  mkdir -p "$(dirname "$launch_file")"
  touch "$launch_file"
  chmod +x "$launch_file"
  fresh=1
fi

# Promote a system file to the user override rather than editing /etc.
case "$launch_file" in
  /etc/xdg/labwc/*)
    user_copy="$config_home/labwc/$(basename "$launch_file")"
    echo "Copying $launch_file -> $user_copy (never editing /etc)"
    mkdir -p "$(dirname "$user_copy")"
    cp "$launch_file" "$user_copy"
    chmod +x "$user_copy"
    launch_file="$user_copy"
    ;;
  /etc/*)
    echo "Found swayidle in $launch_file, but this script will not edit /etc." >&2
    echo "Copy it into ${config_home}/ and re-run with SWAYIDLE_LAUNCH_FILE=<copy>," >&2
    echo "or apply packaging/swayidle/swayidle.snippet by hand." >&2
    exit 1
    ;;
esac

restrip=''
if grep -q 'idle-screens-wayland' "$launch_file"; then
  # Only our own clause counts — an unrelated `--kiosk` elsewhere in the file
  # (another app's flag, a comment) must not decide the mode.
  if grep -Eq "timeout[[:space:]]+[0-9]+[[:space:]]+'[^']*idle-screens-wa[^']*" "$launch_file" \
     && grep -Eq "'[^']*(idle-screens-wayland --kiosk)[^']*'" "$launch_file"; then
    installed_kiosk=1
  else
    installed_kiosk=''
  fi
  if [ -n "$KIOSK" ] && [ -z "$installed_kiosk" ]; then
    # The documented upgrade path (normal install, then kiosk = true): drop our
    # saver clause and fall through so the kiosk args and blank-strip apply.
    echo "$launch_file has a normal install; switching it to kiosk."
    restrip=1
  elif [ -z "$KIOSK" ] && [ -n "$installed_kiosk" ]; then
    echo "$launch_file is a kiosk install. Kiosk removed the display-blank clause, so" >&2
    echo "going back needs it re-added by hand — see packaging/swayidle/swayidle.snippet." >&2
    exit 1
  else
    echo "$launch_file already points at idle-screens — nothing to do."
    exit 0
  fi
fi

backup="${launch_file}.bak.$(date +%s)"
cp "$launch_file" "$backup"

if [ -n "$restrip" ]; then
  # Remove the clause a previous run inserted (saver timeout + its resume hook).
  tmp_strip="$(mktemp)"
  sed -E "s/[[:space:]]*timeout[[:space:]]+[0-9]+[[:space:]]+'idle-screens-wayland[^']*'([[:space:]]*resume[[:space:]]+'pkill[^']*')?//" \
    "$launch_file" > "$tmp_strip"
  cat "$tmp_strip" > "$launch_file"
  rm -f "$tmp_strip"
fi

# Match the kernel's 15-char process name, not the command line. swayidle's own
# command line contains the saver command (`timeout 150 'idle-screens-wayland'`),
# so `pkill -f` would match swayidle too and the first resume would kill the idle
# daemon along with the saver. `-x idle-screens-wa` can only match the saver.
proc='idle-screens-wa'
kill_cmd="pkill -TERM -x ${proc}"

# swayidle's -w waits for a timeout command to finish before continuing. Our
# saver runs until it is dismissed, so under -w swayidle may never process the
# resume that dismisses it — a deadlock that presents as "the saver ignores my
# mouse". Backgrounding the launch sidesteps it, and costs nothing if -w turns
# out to be harmless here: the resume hook and the kiosk pgrep guard both still
# work on a backgrounded process. Raspberry Pi OS's stock line uses -w, so this
# is the common case, not the exotic one.
bg=''
if [ -n "${fresh:-}" ] || grep -Eq 'swayidle([[:space:]]+-[A-Za-z-]+)*[[:space:]]+-w([[:space:]]|$)' "$launch_file"; then
  bg=' &'
fi

if [ -n "$KIOSK" ]; then
  saver_args="timeout ${SAVER_TIMEOUT} 'pgrep -x ${proc} || idle-screens-wayland --kiosk${bg}'"
else
  saver_args="timeout ${SAVER_TIMEOUT} 'idle-screens-wayland${bg}' resume '${kill_cmd}'"
fi

if [ -n "${fresh:-}" ]; then
  {
    echo ""
    echo "# idle-screens saver at ${SAVER_TIMEOUT}s, display blank at ${BLANK_TIMEOUT}s."
    echo "# See packaging/swayidle/swayidle.snippet for the full explanation."
    if [ -n "$KIOSK" ]; then
      echo "swayidle -w ${saver_args} &"
    else
      echo "swayidle -w ${saver_args} \\"
      echo "  timeout ${BLANK_TIMEOUT} 'wlopm --off \\*' resume 'wlopm --on \\*' &"
    fi
  } >> "$launch_file"
  echo "Wrote a swayidle line to $launch_file"
else
  # One awk pass does every edit. awk, not perl: perl is NOT present on a bare
  # Arch system (verified — even with base-devel/git installed), while awk is
  # POSIX and ships everywhere. Line-oriented, which handles the continuation
  # style real swayidle configs use (one timeout clause per line).
  #
  #  1. kiosk only — drop display-blank clauses. Nothing dismisses a kiosk saver,
  #     so blanking would leave the panel dark in front of it.
  #  2. raise any display-blanking timeout that would fire at or before the
  #     saver, so the display cannot blank out from under the overlay. Other
  #     clauses (a swaylock timeout, say) are the user's policy and are left
  #     alone.
  #  3. splice our arguments in after the swayidle command word and its flags.
  #     Position is cosmetic — swayidle evaluates each timeout independently —
  #     so only the numbers from (2) actually order the events.
  tmp="$(mktemp)"
  awk -v saver="$SAVER_TIMEOUT" -v blank="$BLANK_TIMEOUT" -v args="$saver_args" \
      -v kiosk="${KIOSK:-}" -v q="'" '
    BEGIN {
      blanker = "[ \t]*timeout[ \t]+[0-9]+[ \t]+" q "[^" q "]*(wlopm|dpms|wlr-randr)[^" q "]*" q \
                "([ \t]*resume[ \t]+" q "[^" q "]*" q ")?"
    }
    kiosk != "" { gsub(blanker, "") }
    {
      # Rebuild the line left-to-right so a rewritten number is never rescanned.
      out = ""
      while (match($0, /timeout[ \t]+[0-9]+/)) {
        clause = substr($0, RSTART, RLENGTH)
        n = clause; sub(/timeout[ \t]+/, "", n)
        rest = substr($0, RSTART + RLENGTH)
        isblank = (rest ~ ("^[ \t]*" q "[^" q "]*(wlopm|dpms|wlr-randr)[^" q "]*" q))
        if (isblank && n + 0 <= saver + 0) sub(/[0-9]+$/, blank, clause)
        out = out substr($0, 1, RSTART - 1) clause
        $0 = substr($0, RSTART + RLENGTH)
      }
      $0 = out $0
    }
    !spliced && $0 !~ /^[ \t]*#/ {
      # Find `swayidle` used as a command, not as a key (`swayidle = swayidle -w`
      # in wayfire.ini): skip any occurrence that is followed by `=`.
      rest = $0; off = 0
      while (match(rest, /swayidle([ \t]+-[A-Za-z-]+)*/)) {
        after = substr(rest, RSTART + RLENGTH)
        if (after !~ /^[ \t]*=/) {
          pos = off + RSTART + RLENGTH
          $0 = substr($0, 1, pos - 1) " " args substr($0, pos)
          spliced = 1
          break
        }
        off += RSTART + RLENGTH - 1
        rest = substr(rest, RSTART + RLENGTH)
      }
    }
    { print }
  ' "$launch_file" > "$tmp"
  # Copy the contents back rather than mv'ing the temp file over the target:
  # mv would carry mktemp's 0600 onto it, and labwc silently ignores an
  # autostart that is not executable — which would disable the saver AND the
  # user's existing screen blanking, with no error anywhere.
  cat "$tmp" > "$launch_file"
  rm -f "$tmp"

  if [ -n "$KIOSK" ]; then
    if grep -qE 'wlopm|dpms|wlr-randr' "$backup"; then
      echo "Kiosk: removed the display-blank clause (a kiosk saver is never dismissed,"
      echo "       so blanking would leave the panel dark in front of it)."
    elif grep -q 'timeout' "$backup"; then
      echo "Kiosk warning: this swayidle line still has timeout clauses we do not" >&2
      echo "recognise. If one of them blanks or locks the display, remove it by hand" >&2
      echo "or the panel will sleep in front of the saver." >&2
    fi
  fi
  echo "Patched $launch_file"
fi

if [ "$(cat "$launch_file")" = "$(cat "$backup")" ]; then
  rm -f "$backup"
  echo "No change was made — apply packaging/swayidle/swayidle.snippet by hand." >&2
  exit 1
fi
echo "Backup saved to $backup"
echo
grep -n -A3 'swayidle' "$launch_file" | sed 's/^/  /'
echo

if [ -n "$bg" ]; then
  echo "Note: swayidle here runs with -w, which waits for a timeout command to"
  echo "finish, so the saver is launched in the background ('...wayland &'). It is"
  echo "dismissed by the resume hook either way."
  echo
fi

echo "Restart swayidle to pick this up (labwc --reconfigure does NOT re-run autostart):"
echo "  pkill -x swayidle   # then log out and back in, or re-run the line above"
