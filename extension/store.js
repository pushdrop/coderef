const fs = require('fs');
const path = require('path');

function defaultStore() {
  return { nextId: 1, pins: [] };
}

function storeFilePath(root) {
  return path.join(root, '.vscode', 'coderef.json');
}

function load(p) {
  if (!fs.existsSync(p)) return defaultStore();
  try {
    const d = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (typeof d.nextId === 'number' && Array.isArray(d.pins)) return d;
  } catch {}
  return defaultStore();
}

function save(p, s) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(s, null, 2) + '\n');
}

module.exports = { defaultStore, storeFilePath, load, save };
