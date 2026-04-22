#!/bin/bash

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

echo "ARES-X launcher for macOS"
echo "Project: $ROOT_DIR"
echo

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js was not found."
  if command -v brew >/dev/null 2>&1; then
    echo "Installing Node.js with Homebrew..."
    brew install node
  else
    echo "Please install Node.js LTS from https://nodejs.org/ and run this file again."
    echo
    read -n 1 -s -r -p "Press any key to close..."
    exit 1
  fi
fi

node "$ROOT_DIR/ares-x/scripts/run-all.mjs"
STATUS=$?

echo
if [ "$STATUS" -ne 0 ]; then
  echo "ARES-X launcher exited with code $STATUS."
fi
read -n 1 -s -r -p "Press any key to close..."
exit "$STATUS"
