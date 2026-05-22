# coderef

Pin code spans in your editor and reference them from anywhere — by number — in your terminal, your chat with an AI agent, or a teammate's IDE.

Select a few lines, hit a key, get back `#1`. Then `coderef 1` from any terminal in the same project prints the file, line range, and (by default) the source. Hand `#3` to Claude / Cursor / a colleague and they can resolve it the same way.

## Install

```
curl -fsSL https://raw.githubusercontent.com/pushdrop/coderef/master/install.sh | bash
```

This:
- clones the repo to `~/.coderef`
- runs `npm link` so `coderef` is on your PATH
- symlinks the VS Code extension into `~/.vscode/extensions` and `~/.cursor/extensions` (whichever exist)

Reload your editor afterwards: `Cmd+Shift+P` → **Developer: Reload Window**.

Requirements: `git`, `node`, `npm`.

To install to a different location, set `CODEREF_DIR`:
```
CODEREF_DIR=~/code/coderef bash <(curl -fsSL .../install.sh)
```

## Pin a span (editor)

In VS Code or Cursor, select lines and either:
- press **`Cmd+K Cmd+P`** (mac) / **`Ctrl+K Ctrl+P`** (linux/windows), or
- right-click → **CodeRef: Pin Selection**, or
- `Cmd+Shift+P` → **CodeRef: Pin Selection**.

You get:
- a numbered badge in the gutter
- a faint highlight on the pinned lines
- a tick on the overview ruler
- an entry in the **CodeRef** sidebar (activity bar → bookmark icon)
- `1 pin` in the status bar

Click a sidebar entry to jump to it. The inline ✕ clears one pin; the toolbar `Clear All` empties the list.

## Look up a pin (CLI)

```
coderef list                     list every pin (with source)
coderef 3                        show pin #3 (with source)
coderef 3 --no-code              just the header (file + lines)
coderef 3 --json                 machine-readable
coderef list --json --no-code    a compact index for an agent
coderef clear 3                  drop one
coderef clear                    drop all, reset ids to 1
coderef path                     where the storage file lives
```

Default output is:
```
#3  src/components/Toolbar.tsx:71-76
    )}
    <button
        style={{
            ...BTN,
            background: drillDownPanelOpen ? "#3b82f6" : BTN.background,
            co
```

The CLI walks up from `$PWD` looking for a `.git` or `.vscode` directory to find the workspace root, so run it from anywhere inside your project.

## Use with an AI agent

The whole point. In your chat, mention pin numbers like `look at #1 and #3`, then in the same terminal session the agent runs:

```
coderef 1 --json
coderef 3 --json
```

…and it has the file path, line range, and source. When you're done, `coderef clear` wipes the list (and the gutter/sidebar update in real time).

### Via MCP (Claude Desktop, Cursor, etc.)

The same install also gives you `coderef-mcp`, a Model Context Protocol server that exposes pin lookup as tools your agent can call directly — no terminal required.

**Claude Desktop** — add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or the equivalent on your platform:

```json
{
  "mcpServers": {
    "coderef": {
      "command": "coderef-mcp",
      "args": ["--workspace", "/absolute/path/to/your/project"]
    }
  }
}
```

**Claude Code** — register at user scope:

```
claude mcp add coderef --scope user -- coderef-mcp --workspace /absolute/path/to/your/project
```

Restart your host, and the agent gains five tools:

- `list_pins(include_code = true)` — every pin with file, line range, and source
- `get_pin(id, include_code = true)` — resolve a single pin by its numeric id
- `add_pin(file, startLine, endLine?)` — create a new pin (the agent can pin code itself)
- `clear_pin(id)` — drop one pin
- `clear_all_pins()` — wipe all pins and reset ids

Changes made via MCP show up in the editor's gutter and sidebar immediately — the extension watches the storage file. See [for-agents.md](./for-agents.md) for full guidance.

## How it works

Pins live in `<workspace>/.vscode/coderef.json`. The extension watches this file via VS Code's `FileSystemWatcher`, so editor and CLI stay in sync — `coderef clear` in a terminal removes the gutter badges immediately, and pinning in the editor updates the CLI right away.

Schema:
```json
{
  "nextId": 4,
  "pins": [
    { "id": 1, "file": "src/foo.ts", "startLine": 42, "endLine": 58, "createdAt": "..." }
  ]
}
```

Paths are stored relative to the workspace root. Lines are 1-indexed, inclusive on both ends.

## Update

Re-run the installer; it does `git pull --ff-only` on the existing clone.

## Uninstall

```
curl -fsSL https://raw.githubusercontent.com/pushdrop/coderef/master/uninstall.sh | bash
```

Pass `KEEP_SOURCE=1` to leave `~/.coderef` behind.

## Layout

```
coderef/
├── cli/             # the `coderef` command (Node, no build step)
├── extension/       # the VS Code / Cursor extension (plain JS, no build step)
├── install.sh
└── uninstall.sh
```

## License

MIT.
