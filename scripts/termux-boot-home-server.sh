#!/data/data/com.termux/files/usr/bin/bash

set -euo pipefail

PROJECT="/data/data/com.termux/files/home/home-server"

cd "$PROJECT"
exec bash "$PROJECT/start.sh"
