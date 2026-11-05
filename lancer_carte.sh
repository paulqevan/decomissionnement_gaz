#!/usr/bin/env bash
# Sert la carte en local et l'ouvre dans le navigateur. Ctrl+C pour arrêter.
# Usage : ./lancer_carte.sh [port]   (par défaut 8765, ou le suivant libre)
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")"

port_libre() {
  python3 -c 'import socket,sys
s=socket.socket()
try: s.bind(("127.0.0.1", int(sys.argv[1])))
except OSError: sys.exit(1)' "$1"
}

PORT="${1:-8765}"
for _ in $(seq 20); do
  port_libre "$PORT" && break
  echo "Port $PORT déjà utilisé, essai du suivant…"
  PORT=$((PORT + 1))
done
URL="http://localhost:$PORT/"

echo "Carte disponible sur $URL (Ctrl+C pour arrêter)"
( sleep 1; xdg-open "$URL" >/dev/null 2>&1 || true ) &
exec python3 -m http.server "$PORT" --bind 127.0.0.1 --directory carte
