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

# global git ignore entry
GIT_EXCLUDE="$(git config --global --get core.excludesfile 2>/dev/null || true)"
[ -z "$GIT_EXCLUDE" ] && GIT_EXCLUDE="${XDG_CONFIG_HOME:-$HOME/.config}/git/ignore"
if [ -f "$GIT_EXCLUDE" ] && grep -qxF '**/.vscode/coderef.json' "$GIT_EXCLUDE"; then
  # remove the entry and the comment line above it
  sed -i.bak -e '/^# coderef - per-user pin storage$/d' -e '\|^\*\*/\.vscode/coderef\.json$|d' "$GIT_EXCLUDE"
  rm -f "$GIT_EXCLUDE.bak"
  info "removed **/.vscode/coderef.json from $GIT_EXCLUDE"
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
