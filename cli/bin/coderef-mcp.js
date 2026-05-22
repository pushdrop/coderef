#!/usr/bin/env node
// coderef-mcp — Model Context Protocol server for coderef.
//
// Exposes the read-only operations of the coderef CLI as MCP tools so AI
// agents (Claude, Cursor, etc.) can resolve pin references like "#3" by
// looking up the pinned code span.
//
// Talks JSON-RPC over stdio. No external dependencies — reuses lib/store.js
// in this package for storage access.

const fs = require('fs');
const path = require('path');
const { load, storeFilePath, findRoot } = require('../lib/store');
const pkg = require('../package.json');

const PROTOCOL_VERSION = '2025-03-26';

// ─── arg parsing ──────────────────────────────────────────────────────────
function parseArgs(argv) {
  let workspace = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--workspace' || a === '-w') {
      workspace = argv[++i];
    } else if (a === '--help' || a === '-h') {
      process.stdout.write([
        'coderef-mcp — MCP server for coderef',
        '',
        'Usage: coderef-mcp [--workspace <path>]',
        '',
        'Reads pins from <workspace>/.vscode/coderef.json.',
        'If --workspace is omitted, walks up from cwd looking for .git or .vscode.',
        '',
        'Speaks Model Context Protocol over stdio; intended to be launched by an',
        'MCP host such as Claude Desktop, not run interactively.',
        ''
      ].join('\n'));
      process.exit(0);
    } else if (a === '--version' || a === '-V') {
      process.stdout.write(pkg.version + '\n');
      process.exit(0);
    }
  }
  return { workspace };
}

const opts = parseArgs(process.argv.slice(2));

function resolveRoot() {
  if (opts.workspace) return path.resolve(opts.workspace);
  return findRoot(process.cwd());
}

// ─── pin helpers (mirrored from bin/coderef.js) ──────────────────────────
function readSnippet(root, p) {
  const full = path.join(root, p.file);
  if (!fs.existsSync(full)) return null;
  const lines = fs.readFileSync(full, 'utf8').split('\n');
  return lines.slice(p.startLine - 1, p.endLine).join('\n');
}

function pinToJson(root, p, includeCode) {
  const o = { id: p.id, file: p.file, startLine: p.startLine, endLine: p.endLine };
  if (includeCode) {
    const code = readSnippet(root, p);
    o.code = code == null ? null : code;
  }
  return o;
}

// ─── tool definitions ─────────────────────────────────────────────────────
const tools = [
  {
    name: 'list_pins',
    description:
      'List all coderef pins in the workspace. Use this when the user asks ' +
      '"what pins do I have," "list my coderefs," or references the pins as a ' +
      "group without naming an id. Returns each pin's id, file path, line range, " +
      'and (by default) the source lines at that location. The workspace is fixed ' +
      'at server startup; this tool does not change it.',
    inputSchema: {
      type: 'object',
      properties: {
        include_code: {
          type: 'boolean',
          default: true,
          description:
            'If true (default), each pin includes its source lines. Set false ' +
            'for just the id/file/line headers — useful when scanning many pins ' +
            'and you only need locations.'
        }
      },
      additionalProperties: false
    }
  },
  {
    name: 'get_pin',
    description:
      'Resolve a single coderef pin by its numeric id. Use this whenever the ' +
      'user references a specific pin: "look at pin #3", "what\'s #7", "open ' +
      'coderef 12". Returns the pin\'s file, line range, and source code.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'integer',
          description: "The pin's numeric id (the number after `#` in coderef output)."
        },
        include_code: {
          type: 'boolean',
          default: true,
          description:
            'If true (default), includes the source lines. Set false for just ' +
            'the file:line header.'
        }
      },
      required: ['id'],
      additionalProperties: false
    }
  }
];

// ─── JSON-RPC framing ─────────────────────────────────────────────────────
function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

function respond(id, result) {
  if (id === undefined || id === null) return;
  send({ jsonrpc: '2.0', id, result });
}

function respondError(id, code, message) {
  if (id === undefined || id === null) return;
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

function textResult(text, structured, isError) {
  return {
    content: [{ type: 'text', text }],
    ...(structured === undefined ? {} : { structuredContent: structured }),
    ...(isError ? { isError: true } : {})
  };
}

// ─── tool dispatch ────────────────────────────────────────────────────────
function callTool(name, args) {
  args = args || {};
  const root = resolveRoot();
  const store = load(storeFilePath(root));

  if (name === 'list_pins') {
    const includeCode = args.include_code !== false;
    const pins = store.pins.map((p) => pinToJson(root, p, includeCode));
    const result = { pins, count: pins.length };
    return textResult(JSON.stringify(result, null, 2), result);
  }

  if (name === 'get_pin') {
    const id = Number(args.id);
    if (!Number.isFinite(id)) {
      return textResult('id must be a number', { error: 'invalid id' }, true);
    }
    const p = store.pins.find((x) => x.id === id);
    if (!p) {
      return textResult(`No pin #${id}.`, { error: 'not found', id }, true);
    }
    const includeCode = args.include_code !== false;
    const obj = pinToJson(root, p, includeCode);
    return textResult(JSON.stringify(obj, null, 2), obj);
  }

  throw new Error(`Unknown tool: ${name}`);
}

// ─── request dispatch ─────────────────────────────────────────────────────
function handleRequest(msg) {
  const { id, method, params } = msg;
  try {
    if (method === 'initialize') {
      respond(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'coderef', version: pkg.version }
      });
      return;
    }
    if (method === 'notifications/initialized') return;
    if (method === 'ping') {
      respond(id, {});
      return;
    }
    if (method === 'tools/list') {
      respond(id, { tools });
      return;
    }
    if (method === 'tools/call') {
      const result = callTool(params && params.name, (params && params.arguments) || {});
      respond(id, result);
      return;
    }
    respondError(id, -32601, `Method not found: ${method}`);
  } catch (e) {
    if (method === 'tools/call') {
      respond(id, textResult(e.message, { error: e.message }, true));
    } else {
      respondError(id, -32603, e.message);
    }
  }
}

// ─── stdin loop ───────────────────────────────────────────────────────────
let buffer = '';
process.stdin.on('data', (chunk) => {
  buffer += chunk.toString('utf8');
  const lines = buffer.split(/\r?\n/);
  buffer = lines.pop() || '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      handleRequest(JSON.parse(trimmed));
    } catch (e) {
      respondError(null, -32700, 'Parse error: ' + e.message);
    }
  }
});

process.stdin.on('end', () => process.exit(0));
