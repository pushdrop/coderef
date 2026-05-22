#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${CODEREF_DIR:-$HOME/.coderef}"
EXT_DIR_NAME="local.coderef-vscode-0.1.0"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }

bold "coderef uninstaller"

# CLI
if command -v npm >/dev/null 2>&1; then
  info "unlinking CLI"
  npm unlink -g coderef >/dev/null 2>&1 || true
fi

# editor symlinks
for parent in "$HOME/.vscode/extensions" "$HOME/.cursor/extensions"; do
  target="$parent/$EXT_DIR_NAME"
  if [ -L "$target" ] || [ -d "$target" ]; then
    rm -rf "$target"
    info "removed $target"
  fi
done

# source
if [ -d "$INSTALL_DIR" ]; then
  if [ "${KEEP_SOURCE:-0}" = "1" ]; then
    info "kept source: $INSTALL_DIR  (KEEP_SOURCE=1)"
  else
    rm -rf "$INSTALL_DIR"
    info "removed source: $INSTALL_DIR"
  fi
fi

echo
bold "done"
echo "Reload Cursor / VS Code to drop the extension from the UI."
