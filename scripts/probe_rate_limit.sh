#!/usr/bin/env bash
# Probe of the rate-limit segment: the pace digit's colour, and which time figure is printed.
#
# WHY A SCRIPT AND NOT JEST. The unit tests over formatters.ts were green on the very day the
# line fell apart on screen: what breaks is not the function but the road to the terminal —
# colour conversion, segment joining, width accounting. So the probe travels the same road the
# pixels do: build -> hook JSON on stdin -> inspect the BYTES that come out.
#
# WHY NOT IN dist. The built dist/index.js is shared by three accounts (.claude, .claude-second,
# .claude-glm) under one config: building something broken into it breaks the line for all of
# them at once. The probe builds into its own directory and never touches dist.
#
# WHY CLAUDE_CONFIG_DIR IS SWAPPED. The limits cache lives in <config-dir>/powerline/usage, and
# the pace is read from it. A private directory gives the probe exactly the cases it needs,
# leaves the live accounts' caches alone, and stays off the network: a fresh fetchedAt inside
# the TTL closes the call. Each case gets a fresh mktemp directory, so no case can inherit the
# previous one's cache — and nothing on disk is ever deleted by this script.
#
# Run: scripts/probe_rate_limit.sh   (exit code 0 means green)

set -u

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${PROBE_OUT_DIR:-/tmp/pl-probe-rate-limit}"

PASS=0; FAIL=0
ESC=$(printf '\033')

check() {   # check <name> <expected yes|no> <actual yes|no>
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); printf '  ok   %s\n' "$1"
  else FAIL=$((FAIL+1)); printf '  FAIL %s — expected %s, got %s\n' "$1" "$2" "$3"; fi
}
has() {     # has <string> <ERE> -> yes|no
  printf '%s' "$1" | /usr/bin/grep -qE "$2" && echo yes || echo no
}

# --- build into a private directory ----------------------------------------------------------
( cd "$REPO" && npx tsup --out-dir "$OUT" >/dev/null 2>&1 ) || {
  echo "  FAIL build failed — THE PROBE DID NOT RUN, and says nothing about coverage"; exit 2; }

# --- one rendering of the line ----------------------------------------------------------------
# render <window 5h|7d> <elapsed fraction> <utilization|null> <resets iso|none> [FORCE_COLOR] [config]
# Returns the program's output as it is, byte for byte.
render() {
  local win="$1" elapsed="$2" util="$3" resets="$4" fc="${5:-3}" cfgfile="${6:-probe_rate_limit.config.json}"
  local cfg; cfg="$(mktemp -d)"
  mkdir -p "$cfg/powerline/usage"

  python3 - "$cfg/powerline/usage/rate-limit.json" "$win" "$elapsed" "$util" "$resets" <<'PY'
import json, sys, time
path, win, elapsed, util, resets = sys.argv[1], sys.argv[2], float(sys.argv[3]), sys.argv[4], sys.argv[5]
window_ms = 5 * 60 * 60 * 1000 if win == "5h" else 7 * 24 * 60 * 60 * 1000
now = int(time.time() * 1000)
# resets_at is the end of the window; elapsed = (now - (end - window)) / window, so:
end = now + int((1.0 - elapsed) * window_ms)
iso = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(end / 1000)) + "Z"
filled = None if util == "null" else {
    "utilization": float(util),
    "resets_at": None if resets == "none" else iso,
}
limits = {"five_hour": None, "seven_day": None, "seven_day_sonnet": None}
limits["five_hour" if win == "5h" else "seven_day"] = filled
json.dump({"data": {"limits": limits, "fetchedAt": now}, "timestamp": now}, open(path, "w"))
PY

  printf '%s' '{"session_id":"probe","transcript_path":"/dev/null","cwd":"'"$REPO"'","workspace":{"current_dir":"'"$REPO"'","project_dir":"'"$REPO"'"},"model":{"id":"claude-opus-4-1","display_name":"Opus"},"version":"1.0.0"}' \
    | CLAUDE_CONFIG_DIR="$cfg" FORCE_COLOR="$fc" \
      bun "$OUT/index.js" --config="$REPO/scripts/$cfgfile" 2>/dev/null
}

# Visible text: stripped by the SAME expression that measures width (terminal.ts:4) — only
# ESC[<digits and ;>m. A sequence with letters in it (NaN) survives this and stays on screen,
# which is what widened the line back in August. So checking the visible text checks width too.
visible() { printf '%s' "$1" | /usr/bin/sed -E "s/${ESC}\[[0-9;]*m//g"; }

echo "== the time figure appears only when it changes a decision =="

# 1. RESERVE: burning slower than the even line. No time figure at all — nothing to decide.
O=$(render 7d 0.50 42 iso)
check 'reserve: percentage and pace are printed' yes "$(has "$(visible "$O")" '⏳ 42% \+8↓')"
check 'reserve: no time figure of either kind' no "$(has "$(visible "$O")" '(\(|!)[0-9]')"

# 2. TOO FAST: at this rate the limit runs out before the window does -> time to the wall.
O=$(render 7d 0.30 47 iso)
check 'too fast: time to the wall, marked with !' yes "$(has "$(visible "$O")" '⏳ 47% -17↑ !2d8h')"
check 'too fast: no brackets — that form means something else' no "$(has "$(visible "$O")" '\(')"

# 3. NEARLY SPENT: past 90% the forecast is beside the point; the wait is what matters.
O=$(render 7d 0.62 91 iso)
check 'nearly spent: time until reset, in brackets' yes "$(has "$(visible "$O")" '⏳ 91% -29↑ \(2d15h\)')"
check 'nearly spent: no wall marker' no "$(has "$(visible "$O")" '!')"

# 4. A LONG WAIT IS COUNTED IN DAYS, not in dozens of hours nobody divides in their head.
# The whole point of the day form: an hour count that has to be divided in the head never appears.
check 'long wait: days and hours, never a bare "(63h)"' no "$(has "$(visible "$O")" '\([0-9]+h')"

# 5. FIVE-HOUR WINDOW: same shape, its own length. 55% spent in 30% of five hours.
O=$(render 5h 0.30 55 iso)
check '5h window: pace is measured against five hours, not a week' yes \
  "$(has "$(visible "$O")" '⏱ 55% -25↑ !1h13m')"

# 6. YOUNG WINDOW: below PACE_MIN_ELAPSED there is no pace and no forecast — a bare digit with
#    no arrow reads as a broken segment, so nothing is printed but the percentage.
O=$(render 5h 0.10 2 iso)
check 'young window: the percentage is printed' yes "$(has "$(visible "$O")" '⏱ 2%')"
check 'young window: no arrow' no "$(has "$O" '(↑|↓)')"
check 'young window: no time figure either' no "$(has "$(visible "$O")" '(\(|!)[0-9]')"

# 7. NO RESET INSTANT: neither pace nor time can be derived, and neither is invented.
O=$(render 7d 0.50 42 none)
check 'no reset instant: percentage survives, pace does not' yes \
  "$(has "$(visible "$O")" '⏳ 42%')"
check 'no reset instant: no time figure' no "$(has "$(visible "$O")" '(\(|!)[0-9]')"

echo "== the pace digit's palette follows the bar it sits on =="

# The probe's own config puts the segment on cream #fff1c2, the light-theme background. A pastel
# green there measures ~1.4:1 and is not readable, so the dark pair is the one that must appear.
O=$(render 7d 0.50 97 iso)
check 'light bar: overspending digit is dark red #cf222e' yes \
  "$(has "$O" "${ESC}\[38;2;207;34;46m-47↑${ESC}\[[0-9;]+m")"
check 'light bar: no pastel red from the dark palette' no "$(has "$O" "${ESC}\[38;2;243;139;168m")"
check 'light bar: the percentage is NOT coloured' no \
  "$(has "$O" "${ESC}\[38;2;207;34;46m[^m]*97%")"
check 'light bar: no NaN anywhere in the output' no "$(has "$O" 'NaN')"

O=$(render 7d 0.50 42 iso)
check 'light bar: reserve digit is dark green #1a7f37' yes \
  "$(has "$O" "${ESC}\[38;2;26;127;55m\+8↓${ESC}\[[0-9;]+m")"

# Exactly on the line: delta = 0 renders as ↓, so it takes the "under" colour. An edge, not a bug —
# formatters.ts reads `delta < 0 ? "↑" : "↓"`, and zero falls to ↓.
O=$(render 7d 0.50 50 iso)
check 'light bar: 0↓ takes the under colour, as every ↓ does' yes \
  "$(has "$O" "${ESC}\[38;2;26;127;55m0↓${ESC}\[[0-9;]+m")"

# Dark bar: the pastel pair is the readable one there, and it is what must come back.
O=$(render 7d 0.50 97 iso 3 probe_rate_limit.dark.config.json)
check 'dark bar: overspending digit is pastel red #f38ba8' yes \
  "$(has "$O" "${ESC}\[38;2;243;139;168m-47↑${ESC}\[[0-9;]+m")"
check 'dark bar: no dark red from the light palette' no "$(has "$O" "${ESC}\[38;2;207;34;46m")"

O=$(render 7d 0.50 42 iso 3 probe_rate_limit.dark.config.json)
check 'dark bar: reserve digit is pastel green #a6e3a1' yes \
  "$(has "$O" "${ESC}\[38;2;166;227;161m\+8↓${ESC}\[[0-9;]+m")"

# Named outright in the config, the colour wins over whatever the background would have chosen.
O=$(render 7d 0.50 97 iso 3 probe_rate_limit.override.config.json)
check 'configured colour wins over the palette' yes "$(has "$O" "${ESC}\[38;2;255;0;255m-47↑")"
O=$(render 7d 0.50 42 iso 3 probe_rate_limit.override.config.json)
check 'configured colour wins for the reserve digit too' yes "$(has "$O" "${ESC}\[38;2;0;0;255m\+8↓")"

echo "== colour goes through the colorSupport fork, not around it =="

O=$(render 7d 0.50 97 iso 1)
check 'ansi: digit wrapped in the basic code 31' yes "$(has "$O" "${ESC}\[31m-47↑")"
check 'ansi: no raw truecolor on the pace digit' no "$(has "$O" "${ESC}\[38;2;207;34;46m")"

O=$(render 7d 0.50 97 iso 2)
check 'ansi256: digit wrapped in a palette code 38;5' yes "$(has "$O" "${ESC}\[38;5;[0-9]+m-47↑")"
check 'ansi256: no raw truecolor on the pace digit' no "$(has "$O" "${ESC}\[38;2;207;34;46m")"

# none: the WHOLE output is checked, not just our own part. One escape in a line where nobody
# else has colour is garbage on screen, no matter whose it is.
O=$(render 7d 0.50 97 iso 0)
check 'none: the digit is still printed' yes "$(has "$(visible "$O")" '⏳ 97% -47↑')"
check 'none: not one ANSI sequence in the ENTIRE output' no "$(has "$O" "${ESC}\[")"

printf '\ntotal: ok=%d fail=%d\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
