#!/bin/bash
# Starts this game's server (if needed) and opens the game.
# Usage: tools/launch.sh          → Chrome app window, fullscreen (used by the .app)
#        tools/launch.sh --tab    → normal Chrome tab (used by start.command)
PORT=8102 # fixed and unique per game (list in ~/KidGames/CLAUDE.md); Chrome remembers camera permission per port
GAMEDIR="$(cd "$(dirname "$0")/.." && pwd)"
GAME="$(basename "$GAMEDIR")"
URL="http://localhost:$PORT/"

owner() { curl -sI --max-time 1 "$URL" | awk -F': ' 'tolower($1)=="x-kidgame"{print $2}' | tr -d '\r'; }

if [ "$(owner)" != "$GAME" ]; then
  # stops by itself after 3 hours without requests; the game only needs it while loading
  nohup /usr/bin/python3 "$GAMEDIR/tools/server.py" "$PORT" 10800 >/dev/null 2>&1 &
  for _ in $(seq 1 40); do [ "$(owner)" = "$GAME" ] && break; sleep 0.25; done
  if [ "$(owner)" != "$GAME" ]; then
    osascript -e "display alert \"$GAME could not start\" message \"Port $PORT is used by another program.\""
    exit 1
  fi
fi

if [ "$1" = "--tab" ]; then
  open -a "Google Chrome" "$URL" 2>/dev/null || open "$URL"
elif [ -d "/Applications/Google Chrome.app" ]; then
  open -na "Google Chrome" --args --app="$URL" --start-fullscreen
else
  open "$URL"
fi
