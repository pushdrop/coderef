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
const { load, save, storeFilePath, findRoot, defaultStore } = require('../lib/store');
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
  },
  {
    name: 'add_pin',
    description:
      'Create a new pin for a range of lines in a file. Use when the user asks ' +
      'you to pin something - e.g. "pin the foo function", "make a pin for lines ' +
      '40-55 in bar.ts", "add a ref for this block". Returns the new pin id and ' +
      'its header. The pin is assigned the next available id and shows up in the ' +
      "editor's CodeRef sidebar and gutter immediately.",
    inputSchema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          description:
            'Path to the file. Relative paths resolve against the workspace root; ' +
            'absolute paths must live inside the workspace.'
        },
        startLine: {
          type: 'integer',
          minimum: 1,
          description: '1-indexed line where the pin starts.'
        },
        endLine: {
          type: 'integer',
          minimum: 1,
          description:
            '1-indexed line where the pin ends, inclusive. Omit to pin a single line.'
        }
      },
      required: ['file', 'startLine'],
      additionalProperties: false
    }
  },
  {
    name: 'clear_pin',
    description:
      'Remove a single pin by id. Use only when the user names a specific pin to ' +
      'drop ("remove #3", "clear pin 7"). Other pins keep their ids; the id ' +
      'counter only resets when the list becomes empty.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer', description: "The pin's numeric id." }
      },
      required: ['id'],
      additionalProperties: false
    }
  },
  {
    name: 'clear_all_pins',
    description:
      'Wipe every pin in the workspace and reset the id counter to 1. Only call ' +
      'when the user has explicitly asked to clear or wipe their pins ("clear ' +
      'all pins", "wipe the refs", "we\'re done with the pins"). Do not call on ' +
      'your own initiative after resolving pins - the ids are how the user ' +
      'references spans across turns, so unprompted clearing breaks the handle.',
    inputSchema: {
      type: 'object',
      properties: {},
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

  if (name === 'add_pin') {
    const fileArg = String(args.file || '').trim();
    if (!fileArg) {
      return textResult('file is required', { error: 'missing file' }, true);
    }
    const startLine = Number(args.startLine);
    if (!Number.isInteger(startLine) || startLine < 1) {
      return textResult('startLine must be a positive integer', { error: 'invalid startLine' }, true);
    }
    const endLine = args.endLine == null ? startLine : Number(args.endLine);
    if (!Number.isInteger(endLine) || endLine < startLine) {
      return textResult('endLine must be >= startLine', { error: 'invalid endLine' }, true);
    }
    const rootResolved = path.resolve(root);
    const absInput = path.isAbsolute(fileArg) ? fileArg : path.join(rootResolved, fileArg);
    const absResolved = path.resolve(absInput);
    if (absResolved !== rootResolved && !absResolved.startsWith(rootResolved + path.sep)) {
      return textResult('file is outside the workspace', { error: 'outside workspace', file: fileArg }, true);
    }
    if (!fs.existsSync(absResolved) || !fs.statSync(absResolved).isFile()) {
      return textResult(`file not found: ${fileArg}`, { error: 'file not found', file: fileArg }, true);
    }
    const lineCount = fs.readFileSync(absResolved, 'utf8').split('\n').length;
    if (endLine > lineCount) {
      return textResult(
        `endLine ${endLine} exceeds file length (${lineCount})`,
        { error: 'endLine out of range', file: fileArg, lineCount },
        true
      );
    }
    const relPath = path.relative(rootResolved, absResolved);
    const pin = {
      id: store.nextId,
      file: relPath,
      startLine,
      endLine,
      createdAt: new Date().toISOString()
    };
    store.pins.push(pin);
    store.nextId += 1;
    save(storeFilePath(rootResolved), store);
    const result = { pin, message: `Pinned as #${pin.id}.` };
    return textResult(result.message, result);
  }

  if (name === 'clear_pin') {
    const id = Number(args.id);
    if (!Number.isInteger(id)) {
      return textResult('id must be an integer', { error: 'invalid id' }, true);
    }
    const before = store.pins.length;
    store.pins = store.pins.filter((p) => p.id !== id);
    if (store.pins.length === before) {
      return textResult(`No pin #${id}.`, { error: 'not found', id }, true);
    }
    if (store.pins.length === 0) store.nextId = 1;
    save(storeFilePath(root), store);
    const result = { cleared: id, remaining: store.pins.length, message: `Cleared #${id}.` };
    return textResult(result.message, result);
  }

  if (name === 'clear_all_pins') {
    const cleared = store.pins.length;
    save(storeFilePath(root), defaultStore());
    const result = { cleared, message: `Cleared ${cleared} pin${cleared === 1 ? '' : 's'}.` };
    return textResult(result.message, result);
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
