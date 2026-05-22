#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${CODEREF_REPO:-https://github.com/pushdrop/coderef.git}"
INSTALL_DIR="${CODEREF_DIR:-$HOME/.coderef}"
EXT_DIR_NAME="local.coderef-vscode-0.1.0"

bold()  { printf '\033[1m%s\033[0m\n' "$*"; }
dim()   { printf '\033[2m%s\033[0m\n' "$*"; }
info()  { printf '  %s\n' "$*"; }

bold "coderef installer"

# --- prereqs --------------------------------------------------------------
need() { command -v "$1" >/dev/null 2>&1 || { echo "  ! missing: $1" >&2; exit 1; }; }
need git
need node
need npm

# --- clone / update -------------------------------------------------------
if [ -d "$INSTALL_DIR/.git" ]; then
  info "updating $INSTALL_DIR"
  git -C "$INSTALL_DIR" pull --ff-only --quiet
else
  info "cloning into $INSTALL_DIR"
  git clone --quiet "$REPO_URL" "$INSTALL_DIR"
fi

# --- CLI ------------------------------------------------------------------
info "linking CLI (npm link)"
(cd "$INSTALL_DIR/cli" && npm link --silent >/dev/null)
CODEREF_BIN="$(command -v coderef || true)"
if [ -z "$CODEREF_BIN" ]; then
  echo "  ! npm link succeeded but \`coderef\` is not on PATH." >&2
  echo "    Add npm's global bin dir to PATH: $(npm prefix -g)/bin" >&2
fi

# --- global git ignore ----------------------------------------------------
# Pin storage is per-user state, so make sure no one accidentally commits it.
GIT_EXCLUDE="$(git config --global --get core.excludesfile 2>/dev/null || true)"
if [ -z "$GIT_EXCLUDE" ]; then
  GIT_EXCLUDE="${XDG_CONFIG_HOME:-$HOME/.config}/git/ignore"
  mkdir -p "$(dirname "$GIT_EXCLUDE")"
  touch "$GIT_EXCLUDE"
  git config --global core.excludesfile "$GIT_EXCLUDE"
fi
if grep -qxF '**/.vscode/coderef.json' "$GIT_EXCLUDE" 2>/dev/null; then
  dim "  (global git ignore already has **/.vscode/coderef.json)"
else
  printf '\n# coderef - per-user pin storage\n**/.vscode/coderef.json\n' >> "$GIT_EXCLUDE"
  info "added **/.vscode/coderef.json to $GIT_EXCLUDE"
fi

# --- extension symlinks ---------------------------------------------------
LINKED_ANY=0
for parent in "$HOME/.vscode/extensions" "$HOME/.cursor/extensions"; do
  if [ -d "$parent" ]; then
    target="$parent/$EXT_DIR_NAME"
    [ -e "$target" ] || [ -L "$target" ] && rm -rf "$target"
    ln -s "$INSTALL_DIR/extension" "$target"
    info "extension linked into $(dirname "$target")"
    LINKED_ANY=1
  fi
done
if [ "$LINKED_ANY" = "0" ]; then
  dim "  (no VS Code / Cursor extensions dir found — skipping editor install)"
fi

# --- summary --------------------------------------------------------------
echo
bold "done"
[ -n "$CODEREF_BIN" ] && info "CLI:    $CODEREF_BIN"
info "source: $INSTALL_DIR"
echo
echo "Next:"
echo "  - reload Cursor / VS Code  (Cmd+Shift+P -> 'Developer: Reload Window')"
echo "  - in any project: select code, press Cmd+K Cmd+P  (or right-click -> CodeRef: Pin Selection)"
echo "  - from the terminal in that project: \`coderef list\`"
echo
echo "Uninstall: bash <(curl -fsSL https://raw.githubusercontent.com/pushdrop/coderef/master/uninstall.sh)"
