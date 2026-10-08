#!/usr/bin/env bash
# Tests for install-swayidle.sh. It rewrites a user's session config, so it gets
# the same treatment as code: run it against fabricated launch files and assert
# on the result. Needs only bash, perl and coreutils — no swayidle, no Wayland,
# no display, and no perl or diffutils — a bare Arch system has neither, which
# is why the installer is written in awk. Run: ./scripts/test-swayidle-install.sh
set -uo pipefail
cd "$(dirname "$0")/.."
installer="$PWD/packaging/swayidle/install-swayidle.sh"

pass=0 fail=0
sandbox=""
setup() { # setup [<contents of ~/.config/labwc/autostart>]
  sandbox="$(mktemp -d)"
  mkdir -p "$sandbox/.config/labwc" "$sandbox/bin"
  printf '#!/bin/sh\n' > "$sandbox/bin/swayidle"; chmod +x "$sandbox/bin/swayidle"
  [ $# -gt 0 ] && printf '%s\n' "$1" > "$sandbox/.config/labwc/autostart"
  export HOME="$sandbox" XDG_CONFIG_HOME="$sandbox/.config" PATH="$sandbox/bin:$PATH"
}
run() { ( cd "$sandbox" && "$installer" ) >"$sandbox/out" 2>&1; echo $?; }
result() { cat "$sandbox/.config/labwc/autostart" 2>/dev/null; }

check() { # check <name> <expected-substring> <actual>
  if [[ "$3" == *"$2"* ]]; then pass=$((pass+1)); printf '  ok   %s\n' "$1"
  else fail=$((fail+1)); printf '  FAIL %s\n       want substring: %s\n       got: %s\n' "$1" "$2" "$3"; fi
}
check_not() {
  if [[ "$3" != *"$2"* ]]; then pass=$((pass+1)); printf '  ok   %s\n' "$1"
  else fail=$((fail+1)); printf '  FAIL %s\n       must NOT contain: %s\n       got: %s\n' "$1" "$2" "$3"; fi
}

STOCK="swayidle -w timeout 600 'wlopm --off \\*' resume 'wlopm --on \\*' &"

echo "stock Raspberry Pi OS line (-w present)"
setup "$STOCK"; run >/dev/null; got="$(result)"
check "saver added at the default timeout"      "timeout 150 'idle-screens-wayland &'" "$got"
check "backgrounded because swayidle uses -w"   "idle-screens-wayland &'"              "$got"
check "resume hook matches the process name"    "pkill -TERM -x idle-screens-wa"        "$got"
check_not "resume hook cannot match swayidle"   "pkill -TERM -f"                        "$got"
check "existing blank timeout left alone"       "timeout 600 'wlopm --off"              "$got"
check "still a single swayidle process"         "swayidle -w timeout 150"               "$got"
[ "$(grep -c swayidle <<<"$got")" = 1 ] && { pass=$((pass+1)); echo "  ok   exactly one swayidle line"; } \
  || { fail=$((fail+1)); echo "  FAIL more than one swayidle line"; }

echo "no -w: launch stays in the foreground"
setup "swayidle timeout 600 'wlopm --off \\*' resume 'wlopm --on \\*' &"; run >/dev/null; got="$(result)"
check     "saver was added"  "timeout 150 'idle-screens-wayland'" "$got"
check_not "not backgrounded" "idle-screens-wayland &'" "$got"

echo "-w after another flag is still detected"
setup "swayidle -d -w timeout 600 'wlopm --off \\*' resume 'wlopm --on \\*' &"; run >/dev/null
check "backgrounded" "idle-screens-wayland &'" "$(result)"

echo "only the blanking timeout is raised, not a lock timeout"
setup "swayidle -w timeout 60 'swaylock -f' timeout 120 'wlopm --off \\*' resume 'wlopm --on \\*' &"; run >/dev/null; got="$(result)"
check "lock timeout untouched" "timeout 60 'swaylock -f'" "$got"
check "blank timeout raised"   "timeout 900 'wlopm --off" "$got"

echo "a wayfire-style key before = is not the splice target"
setup "swayidle = swayidle -w timeout 600 'wlopm --off \\*' resume 'wlopm --on \\*' &"; run >/dev/null; got="$(result)"
check     "args land after the command" "swayidle = swayidle -w timeout 150 'idle-screens-wayland &'" "$got"

echo "normal install, then KIOSK=1, converts to kiosk"
setup "$STOCK"; run >/dev/null; KIOSK=1 run >/dev/null; got="$(result)"
check     "kiosk saver present"  "idle-screens-wayland --kiosk" "$got"
check_not "resume hook gone"     "pkill"                        "$got"
check_not "blanking gone"        "wlopm"                        "$got"
check_not "no normal saver left" "timeout 150 'idle-screens-wayland &'" "$got"

echo "an unrelated --kiosk elsewhere does not block the kiosk upgrade"
setup "# other-app --kiosk
$STOCK"; run >/dev/null; KIOSK=1 run >/dev/null; got="$(result)"
check "converted to kiosk" "idle-screens-wayland --kiosk" "$got"
check_not "no normal saver left" "timeout 150 'idle-screens-wayland &'" "$got"

echo "a commented swayidle example is not the splice target"
setup "# swayidle -w timeout 1 'x'
swayidle -w timeout 600 'wlopm --off \\*' resume 'wlopm --on \\*' &"; run >/dev/null; got="$(result)"
check "live line got the saver" "swayidle -w timeout 150 'idle-screens-wayland &'" "$got"

echo "blank timeout below the saver timeout gets raised"
setup "swayidle -w timeout 120 'wlopm --off \\*' resume 'wlopm --on \\*' &"; run >/dev/null; got="$(result)"
check     "raised to BLANK_TIMEOUT" "timeout 900 'wlopm --off"  "$got"
check_not "old value is gone"       "timeout 120"               "$got"

echo "kiosk strips the blanking clause"
setup "$STOCK"; KIOSK=1 run >/dev/null; got="$(result)"
check     "kiosk flag is passed"  "idle-screens-wayland --kiosk" "$got"
check_not "wlopm removed"         "wlopm"                        "$got"
check_not "no resume hook"        "pkill"                        "$got"

echo "kiosk warns when it cannot recognise the blanker"
setup "swayidle -w timeout 600 'my-blanker off' resume 'my-blanker on' &"; KIOSK=1 run >/dev/null
check "warning printed" "still has timeout clauses we do not" "$(cat "$sandbox/out")"

echo "fresh session with no swayidle anywhere"
setup; run >/dev/null; got="$(result)"
check "writes a swayidle line"  "swayidle -w timeout 150" "$got"
check "includes blanking"       "timeout 900 'wlopm --off" "$got"

echo "file permissions are preserved"
# labwc silently ignores a non-executable autostart, so losing the mode here
# would disable both the saver and the user's existing blanking, with no error.
setup "$STOCK"; chmod 755 "$sandbox/.config/labwc/autostart"; run >/dev/null
mode="$(stat -c '%a' "$sandbox/.config/labwc/autostart" 2>/dev/null \
        || stat -f '%Lp' "$sandbox/.config/labwc/autostart")"
check "mode still 755" "755" "$mode"

echo "idempotence"
setup "$STOCK"; run >/dev/null; first="$(result)"; code="$(run)"
check "second run is a no-op"   "already points at idle-screens" "$(cat "$sandbox/out")"
check "exit 0 on no-op"         "0"                              "$code"
[ "$first" = "$(result)" ] && { pass=$((pass+1)); echo "  ok   file unchanged by the second run"; } \
  || { fail=$((fail+1)); echo "  FAIL second run modified the file"; }

echo "guard: BLANK_TIMEOUT must exceed SAVER_TIMEOUT"
setup "$STOCK"; code="$(BLANK_TIMEOUT=100 run)"
check "refuses"  "1" "$code"
check "explains" "must be greater than" "$(cat "$sandbox/out")"

echo "refuses to edit /etc"
setup "$STOCK"; code="$(SWAYIDLE_LAUNCH_FILE=/etc/somewhere/config run)"
check "refuses"  "1" "$code"
check "explains" "will not edit /etc" "$(cat "$sandbox/out")"

echo
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
