#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { load, save, storeFilePath, findRoot, defaultStore } = require('../lib/store');

const args = process.argv.slice(2);
const root = findRoot(process.cwd());
const file = storeFilePath(root);

function readSnippet(p) {
  const full = path.join(root, p.file);
  if (!fs.existsSync(full)) return null;
  const lines = fs.readFileSync(full, 'utf8').split('\n');
  return lines.slice(p.startLine - 1, p.endLine).join('\n');
}

function rangeStr(p) {
  return p.startLine === p.endLine ? String(p.startLine) : `${p.startLine}-${p.endLine}`;
}

function fmtPinHuman(p, opts) {
  let s = `#${p.id}  ${p.file}:${rangeStr(p)}`;
  if (opts.code) {
    const code = readSnippet(p);
    if (code == null) {
      s += '\n    (file not found: ' + p.file + ')';
    } else {
      s += '\n' + code.split('\n').map(l => '    ' + l).join('\n');
    }
  }
  return s;
}

function pinToJson(p, opts) {
  const o = { id: p.id, file: p.file, startLine: p.startLine, endLine: p.endLine };
  if (opts.code) {
    const code = readSnippet(p);
    o.code = code == null ? null : code;
  }
  return o;
}

function parseOpts(rest) {
  const opts = { code: true, json: false };
  for (const a of rest) {
    if (a === '--code' || a === '-c') opts.code = true;
    else if (a === '--no-code' || a === '-n') opts.code = false;
    else if (a === '--json' || a === '-j') opts.json = true;
  }
  return opts;
}

function usage() {
  process.stdout.write(`coderef - pin code spans in your editor and look them up by number

Usage:
  coderef list  [--no-code] [--json]              list all pins (code included by default)
  coderef get <id> [--no-code] [--json]           show one pin
  coderef <id>     [--no-code] [--json]           shorthand for "get <id>"
  coderef add <file> <startLine> [endLine] [-j]   create a new pin
  coderef add <file>:<startLine>[-<endLine>] [-j] same, with range syntax
  coderef open <id> [--print]                     open the pin in your editor
  coderef clear [<id>]                            clear all pins, or one by id
  coderef path                                    print the storage file path
  coderef help                                    show this help

Default output is "#<id>  <file>:<startLine>[-<endLine>]" followed by the source lines.
Pass --no-code (-n) for just the header line. Add --json for machine-readable output.
Pins live in <workspace>/.vscode/coderef.json.
`);
}

const cmd = args[0];
const rest = args.slice(1);

if (!cmd || cmd === 'help' || cmd === '-h' || cmd === '--help') {
  usage();
  process.exit(0);
}

if (cmd === 'path') {
  process.stdout.write(file + '\n');
  process.exit(0);
}

const store = load(file);

if (cmd === 'list') {
  const opts = parseOpts(rest);
  if (opts.json) {
    process.stdout.write(JSON.stringify(store.pins.map(p => pinToJson(p, opts)), null, 2) + '\n');
    process.exit(0);
  }
  if (store.pins.length === 0) {
    process.stdout.write('(no pins)\n');
    process.exit(0);
  }
  for (const p of store.pins) process.stdout.write(fmtPinHuman(p, opts) + '\n');
  process.exit(0);
}

function parseId(raw) {
  const m = /^#?(\d+)$/.exec(String(raw || '').trim());
  return m ? parseInt(m[1], 10) : NaN;
}

if (cmd === 'get' || /^#?\d+$/.test(cmd)) {
  const idRaw = cmd === 'get' ? rest[0] : cmd;
  const id = parseId(idRaw);
  if (!Number.isFinite(id)) {
    process.stderr.write('Need a pin id (e.g. `coderef get 3` or `coderef 3`).\n');
    process.exit(2);
  }
  const opts = parseOpts(cmd === 'get' ? rest.slice(1) : rest);
  const p = store.pins.find(x => x.id === id);
  if (!p) {
    process.stderr.write(`No pin #${id}.\n`);
    process.exit(1);
  }
  if (opts.json) {
    process.stdout.write(JSON.stringify(pinToJson(p, opts), null, 2) + '\n');
  } else {
    process.stdout.write(fmtPinHuman(p, opts) + '\n');
  }
  process.exit(0);
}

if (cmd === 'clear') {
  if (rest.length === 0) {
    save(file, defaultStore());
    process.stdout.write('Cleared all pins.\n');
    process.exit(0);
  }
  const id = parseId(rest[0]);
  if (!Number.isFinite(id)) {
    process.stderr.write('Need a pin id to clear one (or no arg to clear all).\n');
    process.exit(2);
  }
  const before = store.pins.length;
  store.pins = store.pins.filter(p => p.id !== id);
  if (store.pins.length === before) {
    process.stderr.write(`No pin #${id}.\n`);
    process.exit(1);
  }
  if (store.pins.length === 0) store.nextId = 1;
  save(file, store);
  process.stdout.write(`Cleared #${id}.\n`);
  process.exit(0);
}

if (cmd === 'open') {
  const printOnly = rest.includes('--print') || rest.includes('-p');
  const positional = rest.filter(a => !a.startsWith('-'));
  const id = parseId(positional[0]);
  if (!Number.isFinite(id)) {
    process.stderr.write('Need a pin id (e.g. `coderef open 3`).\n');
    process.exit(2);
  }
  const p = store.pins.find(x => x.id === id);
  if (!p) {
    process.stderr.write(`No pin #${id}.\n`);
    process.exit(1);
  }
  const abs = path.join(root, p.file);
  const target = `${abs}:${p.startLine}:1`;

  if (printOnly) {
    process.stdout.write(target + '\n');
    process.exit(0);
  }

  const { spawnSync } = require('child_process');
  const candidates = [];
  if (process.env.CODEREF_EDITOR) candidates.push(process.env.CODEREF_EDITOR);
  candidates.push('cursor', 'code');

  for (const bin of candidates) {
    const which = spawnSync('command', ['-v', bin], { shell: true, encoding: 'utf8' });
    if (which.status !== 0 || !which.stdout.trim()) continue;
    const res = spawnSync(bin, ['--goto', target], { stdio: 'inherit' });
    if (res.error) continue;
    process.exit(res.status || 0);
  }

  process.stderr.write('No editor found on PATH (tried CODEREF_EDITOR, cursor, code). Location:\n');
  process.stdout.write(target + '\n');
  process.exit(0);
}

if (cmd === 'add') {
  const flags = rest.filter(a => a.startsWith('-'));
  const positional = rest.filter(a => !a.startsWith('-'));
  const json = flags.includes('--json') || flags.includes('-j');

  let fileArg, startLine, endLine;
  if (positional.length === 0) {
    process.stderr.write('Usage: coderef add <file> <startLine> [endLine]\n');
    process.stderr.write('       coderef add <file>:<startLine>[-<endLine>]\n');
    process.exit(2);
  } else if (positional.length === 1) {
    const m = /^(.+):(\d+)(?:-(\d+))?$/.exec(positional[0]);
    if (!m) {
      process.stderr.write('Expected <file>:<startLine>[-<endLine>] or <file> <startLine> [endLine]\n');
      process.exit(2);
    }
    fileArg = m[1];
    startLine = parseInt(m[2], 10);
    endLine = m[3] != null ? parseInt(m[3], 10) : startLine;
  } else {
    fileArg = positional[0];
    startLine = parseInt(positional[1], 10);
    endLine = positional[2] != null ? parseInt(positional[2], 10) : startLine;
  }

  if (!Number.isInteger(startLine) || startLine < 1) {
    process.stderr.write('startLine must be a positive integer.\n');
    process.exit(2);
  }
  if (!Number.isInteger(endLine) || endLine < startLine) {
    process.stderr.write('endLine must be >= startLine.\n');
    process.exit(2);
  }

  const rootResolved = path.resolve(root);
  const absInput = path.isAbsolute(fileArg) ? fileArg : path.resolve(process.cwd(), fileArg);
  const absResolved = path.resolve(absInput);
  if (absResolved !== rootResolved && !absResolved.startsWith(rootResolved + path.sep)) {
    process.stderr.write(`File is outside the workspace: ${fileArg}\n`);
    process.exit(2);
  }
  if (!fs.existsSync(absResolved) || !fs.statSync(absResolved).isFile()) {
    process.stderr.write(`File not found: ${fileArg}\n`);
    process.exit(2);
  }
  const lineCount = fs.readFileSync(absResolved, 'utf8').split('\n').length;
  if (endLine > lineCount) {
    process.stderr.write(`endLine ${endLine} exceeds file length (${lineCount}).\n`);
    process.exit(2);
  }

  const relPath = path.relative(rootResolved, absResolved);
  const pin = {
    id: store.nextId,
    file: relPath,
    startLine,
    endLine,
    createdAt: new Date().toISOString(),
  };
  store.pins.push(pin);
  store.nextId += 1;
  save(file, store);

  if (json) {
    process.stdout.write(JSON.stringify(pinToJson(pin, { code: true, json: true }), null, 2) + '\n');
  } else {
    process.stdout.write(`Pinned as #${pin.id}  ${pin.file}:${rangeStr(pin)}\n`);
  }
  process.exit(0);
}

process.stderr.write(`Unknown command: ${cmd}\n\n`);
usage();
process.exit(2);
