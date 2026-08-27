#!/bin/bash
# Проба цвета цифры темпа в сегменте недельного лимита.
#
# ПОЧЕМУ СКРИПТ, А НЕ JEST. Изолированная проверка функции уже была зелёной ровно в тот день,
# когда строка у всего стада разваливалась: цвет ломается не в функции, а по дороге на экран —
# в переводе цвета, в склейке сегментов и в подсчёте ширины. Поэтому проба идёт тем же путём,
# что пиксели: правка исходника -> сборка -> hook-JSON на stdin -> разбор БАЙТОВ вывода.
#
# ПОЧЕМУ НЕ В dist. Собранный dist/index.js один на три аккаунта (.claude, .claude-second,
# .claude-glm) с одним конфигом: собрать сюда сломанное значит сломать строку всему стаду
# разом. Проба собирает в свой каталог и dist не касается.
#
# ПОЧЕМУ ПОДМЕНЁН CLAUDE_CONFIG_DIR. Кэш лимитов лежит в <config-dir>/powerline/usage, и
# оттуда же берётся темп. Своя папка даёт пробе ровно те четыре случая, которые нужны, не
# трогает кэш живых аккаунтов и не ходит в сеть: свежий fetchedAt внутри TTL закрывает вызов.
#
# Прогон: scripts/probe_pace_color.sh   (код возврата 0 — зелено)
set -u

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${PROBE_OUT_DIR:-/tmp/pl-probe-pace}"
SB="$(mktemp -d)"
trap 'rm -rf "$SB"' EXIT

PASS=0; FAIL=0
ESC=$(printf '\033')

check() {   # check <название> <ожидание yes|no> <факт yes|no>
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); printf '  ok   %s\n' "$1"
  else FAIL=$((FAIL+1)); printf '  FAIL %s — ждали %s, получили %s\n' "$1" "$2" "$3"; fi
}
has() {     # has <строка> <ERE> -> yes|no
  printf '%s' "$1" | /usr/bin/grep -qE "$2" && echo yes || echo no
}

# --- сборка в свой каталог -----------------------------------------------------------------
( cd "$REPO" && npx tsup --out-dir "$OUT" >/dev/null 2>&1 ) || {
  echo "  FAIL сборка не прошла — прогон НЕ СОСТОЯЛСЯ, про покрытие не сказано ничего"; exit 2; }

WEEK_MS=$((7*24*60*60*1000))

# --- одна отрисовка строки -------------------------------------------------------------------
# render <elapsed-доля> <utilization|null> <resets|none> [FORCE_COLOR]
# Возвращает вывод программы как есть, байт в байт.
render() {
  local elapsed="$1" util="$2" resets="$3" fc="${4:-3}"
  local cfg="$SB/cfg"; rm -rf "$cfg"; mkdir -p "$cfg/powerline/usage"

  python3 - "$cfg/powerline/usage/rate-limit.json" "$elapsed" "$util" "$resets" "$WEEK_MS" <<'PY'
import json, sys, time
path, elapsed, util, resets, week_ms = sys.argv[1], float(sys.argv[2]), sys.argv[3], sys.argv[4], int(sys.argv[5])
now = int(time.time() * 1000)
# resets_at = конец окна; elapsed = (now - (end - WEEK)) / WEEK, отсюда end = now + (1-elapsed)*WEEK
end = now + int((1.0 - elapsed) * week_ms)
iso = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(end / 1000)) + "Z"
seven = None if util == "null" else {
    "utilization": float(util),
    "resets_at": None if resets == "none" else iso,
}
limits = {
    "five_hour": {"utilization": 17.0, "resets_at": iso},
    "seven_day": seven,
    "seven_day_sonnet": None,
}
json.dump({"data": {"limits": limits, "fetchedAt": now}, "timestamp": now}, open(path, "w"))
PY

  printf '%s' '{"session_id":"probe","transcript_path":"/dev/null","cwd":"'"$REPO"'","workspace":{"current_dir":"'"$REPO"'","project_dir":"'"$REPO"'"},"model":{"id":"claude-opus-4-1","display_name":"Opus"},"version":"1.0.0"}' \
    | CLAUDE_CONFIG_DIR="$cfg" FORCE_COLOR="$fc" \
      bun "$OUT/index.js" --config="$REPO/scripts/probe_pace_color.config.json" 2>/dev/null
}

# Видимый текст: снимается ТЕМ ЖЕ выражением, что считает ширину (terminal.ts:4) — только
# ESC[<цифры и ;>m. Последовательность с буквами (NaN) им не снимается и останется на виду,
# из-за чего вчера ехала и ширина. Поэтому сверка видимого текста — это и проверка ширины.
visible() { printf '%s' "$1" | /usr/bin/sed -E "s/${ESC}\[[0-9;]*m//g"; }

echo "== цифра темпа несёт свой цвет =="

# 1. ПЕРЕЖИГ: -47↑ красная. Утилизация 97 при пройденной половине окна -> delta = -47.
O=$(render 0.50 97 iso)
check 'пережиг: цифра со стрелкой обёрнута красным, закрыта ВЕРНЫМ escape' yes \
  "$(has "$O" "${ESC}\[38;2;243;139;168m-47↑${ESC}\[[0-9;]+m \(")"
check 'пережиг: проценты НЕ покрашены (перед 97% цвета темпа нет)' no \
  "$(has "$O" "${ESC}\[38;2;243;139;168m[^m]*97%")"
check 'пережиг: NaN в выводе нет' no "$(has "$O" 'NaN')"
check 'пережиг: ширина не поехала — видимый текст ровно ожидаемый' yes \
  "$(has "$(visible "$O")" '⏳ 97% -47↑ \(')"

# 2. ЗАПАС: +8↓ зелёная.
O=$(render 0.50 42 iso)
check 'запас: цифра со стрелкой обёрнута зелёным, закрыта ВЕРНЫМ escape' yes \
  "$(has "$O" "${ESC}\[38;2;166;227;161m\+8↓${ESC}\[[0-9;]+m \(")"
check 'запас: хвост со временем НЕ покрашен' yes "$(has "$(visible "$O")" '⏳ 42% \+8↓ \(')"
check 'запас: NaN в выводе нет' no "$(has "$O" 'NaN')"

# 3. КРАЙ: ровно на линии delta = 0 -> стрелка ↓, то есть зелёная. Не ошибка, а край:
#    в formatters.ts:122 условие `delta < 0 ? "↑" : "↓"`, ноль попадает в ↓.
O=$(render 0.50 50 iso)
check 'ровно на линии: 0↓ красится зелёным, как и всякая ↓' yes \
  "$(has "$O" "${ESC}\[38;2;166;227;161m0↓${ESC}\[[0-9;]+m \(")"

# 4. СТРЕЛКИ НЕТ: до PACE_MIN_ELAPSED (0.15) темп приходит без стрелки — красить нечего.
O=$(render 0.10 2 iso)
check 'без стрелки: цифра выведена' yes "$(has "$(visible "$O")" '⏳ 2% \+8 \(')"
check 'без стрелки: цвета темпа в строке нет вовсе' no \
  "$(has "$O" "${ESC}\[38;2;(243;139;168|166;227;161)m")"

# 5. ТЕМПА НЕТ ВОВСЕ: formatWeekPace вернул null (нет времени сброса) — в тексте нет и цифры.
O=$(render 0.50 42 none)
check 'темпа нет: процент выведен, темпа в тексте нет' yes "$(has "$(visible "$O")" '⏳ 42%')"
check 'темпа нет: стрелок в строке нет' no "$(has "$O" '(↑|↓)')"
check 'темпа нет: цвета темпа в строке нет вовсе' no \
  "$(has "$O" "${ESC}\[38;2;(243;139;168|166;227;161)m")"

echo "== цвет идёт через развилку colorSupport, а не мимо неё =="

# ansi: базовые коды, truecolor-последовательности быть не должно.
O=$(render 0.50 97 iso 1)
check 'ansi: цифра обёрнута базовым кодом 31' yes "$(has "$O" "${ESC}\[31m-47↑")"
check 'ansi: сырого truecolor у темпа нет' no "$(has "$O" "${ESC}\[38;2;243;139;168m")"

# ansi256: код палитры, truecolor быть не должно.
O=$(render 0.50 97 iso 2)
check 'ansi256: цифра обёрнута кодом палитры 38;5' yes "$(has "$O" "${ESC}\[38;5;[0-9]+m-47↑")"
check 'ansi256: сырого truecolor у темпа нет' no "$(has "$O" "${ESC}\[38;2;243;139;168m")"

# none: проверяется ВЕСЬ вывод, а не свой кусок. Одна последовательность в строке, где цвета
# нет ни у кого, — это мусор на экране, и неважно, чья она.
O=$(render 0.50 97 iso 0)
check 'none: цифра выведена' yes "$(has "$(visible "$O")" '⏳ 97% -47↑')"
check 'none: во ВСЁМ выводе нет ни одной ANSI-последовательности' no "$(has "$O" "${ESC}\[")"

printf '\nитог: ok=%d fail=%d\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
