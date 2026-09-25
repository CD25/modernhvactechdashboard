#!/usr/bin/env sh
# Start the dashboard on this Mac or Linux computer.
cd "$(dirname "$0")"
command -v node >/dev/null 2>&1 || { echo "Install Node.js LTS from https://nodejs.org first."; exit 1; }
if [ ! -f .env ]; then cp .env.example .env; echo "Created .env - fill it in, then run this again."; exit 0; fi
( sleep 2; (command -v open >/dev/null && open http://localhost:8080) || (command -v xdg-open >/dev/null && xdg-open http://localhost:8080) ) >/dev/null 2>&1 &
exec node server/index.js
