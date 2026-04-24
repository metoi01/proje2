#!/bin/bash

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

MODE="${1:-start}"
if [ "$#" -gt 0 ]; then
  shift
fi

NODE_ARGS=()

case "$MODE" in
  start)
    ;;
  test|tests)
    NODE_ARGS+=("--run-tests")
    ;;
  check|dry-run)
    NODE_ARGS+=("--check")
    ;;
  help|-h|--help)
    echo "ARES-X launcher for macOS"
    echo
    echo "Usage:"
    echo "  ./RUN_ARES_X_MAC.command"
    echo "  ./RUN_ARES_X_MAC.command start"
    echo "  ./RUN_ARES_X_MAC.command test"
    echo "  ./RUN_ARES_X_MAC.command check"
    echo
    echo "Modes:"
    echo "  start  Launch the ARES-X app stack"
    echo "  test   Run all tests under ares-x/tests with live output"
    echo "  check  Verify launcher dependencies without starting services"
    echo
    read -n 1 -s -r -p "Press any key to close..."
    exit 0
    ;;
  *)
    echo "Unknown mode: $MODE"
    echo "Use ./RUN_ARES_X_MAC.command help to see available modes."
    echo
    read -n 1 -s -r -p "Press any key to close..."
    exit 1
    ;;
esac

echo "ARES-X launcher for macOS"
echo "Project: $ROOT_DIR"
echo "Mode: $MODE"
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

node "$ROOT_DIR/ares-x/scripts/run-all.mjs" "${NODE_ARGS[@]}" "$@"
STATUS=$?

echo
if [ "$STATUS" -ne 0 ]; then
  echo "ARES-X launcher exited with code $STATUS."
fi
read -n 1 -s -r -p "Press any key to close..."
exit "$STATUS"
