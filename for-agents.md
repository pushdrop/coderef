# coderef — for agents

If you're an AI agent working in a repo that uses **coderef**, the user pins
code spans in their editor and refers to them by number (`#1`, `#3`, …). Your
job is to resolve those numbers to the actual file + line range + source code
without having to ask the user where to look.

You have two ways to do that, depending on what's available to you.

## 1. Via the CLI (works in any shell session)

The `coderef` binary is on the user's `PATH` after a normal install. Run it
from anywhere inside the project — it walks up from `$PWD` to find the
workspace root.

```
coderef list --json              # every pin, with source
coderef 3 --json                 # one pin (preferred when the user named #3)
coderef 3 --no-code --json       # just the header (file + lines)
coderef list --no-code --json    # compact index — id/file/lines only
```

Pins live in `<workspace>/.vscode/coderef.json`. The schema:

```json
{
  "id": 3,
  "file": "src/foo.ts",
  "startLine": 42,
  "endLine": 58
}
```

Paths are relative to the workspace root. Lines are 1-indexed and inclusive on
both ends. Read source for a pin with the standard `read file` tool you
already use, using those line bounds, or trust `coderef`'s `code` field.

## 2. Via MCP

If your host (Claude Desktop, Claude Code, Cursor, etc.) is set up with the
`coderef-mcp` server, you have two tools available:

- **`list_pins(include_code?: boolean = true)`** — returns the full array of
  pins as JSON. Use this when the user asks "what pins do I have," "list my
  coderefs," or references the pins as a group.

- **`get_pin(id: integer, include_code?: boolean = true)`** — resolves one
  pin. Use this whenever the user names a specific pin: "look at pin #3,"
  "what's #7," "open coderef 12."

Default `include_code: true` — you'll get the source lines inline. Pass
`false` only when you're scanning many pins and just need locations.

The MCP server is **read-only**. Pinning new code and clearing pins happen in
the editor or via the `coderef` CLI — you should not assume you can mutate
pins from MCP.

### Setup for a new MCP host

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`):

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

**Claude Code**:

```
claude mcp add coderef --scope user -- coderef-mcp --workspace /absolute/path/to/your/project
```

`--workspace` is optional; if omitted, the server walks up from the spawning
process's cwd looking for `.git` or `.vscode`. Passing it explicitly is the
reliable way — MCP hosts spawn servers in unpredictable working directories.

After updating config, restart the host (Cmd+Q + reopen for Claude Desktop;
new session for Claude Code).

## Rules of thumb

- When the user says **"#3"** (or "pin 3" or "coderef 3"), call `get_pin(3)`
  or `coderef 3 --json` immediately — don't ask which file.
- When they say **"what pins do I have"** or refer to "the pins" generally,
  call `list_pins()` or `coderef list --json`.
- Pin source can be stale if the file has changed since the pin was created.
  If you read a pin and the surrounding context doesn't match what the user
  is describing, mention it and offer to confirm against the current file.
- Don't surface the storage file path in your reply unless the user
  explicitly asks. It's an implementation detail.
