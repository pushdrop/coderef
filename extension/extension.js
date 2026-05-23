const vscode = require('vscode');
const path = require('path');
const { load, save, storeFilePath, defaultStore } = require('./store');

let store = defaultStore();
let storePath = '';
let watcherDisposable = null;
const decorationsById = new Map();
let treeProvider;
let statusItem;
let suppressNextWatcherEvent = false;

function workspaceRoot() {
  return vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0]
    ? vscode.workspace.workspaceFolders[0].uri.fsPath
    : undefined;
}

function makeGutterIcon(id) {
  const label = String(id);
  const fontSize = label.length <= 2 ? 11 : label.length === 3 ? 9 : 8;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">` +
    `<text x="8" y="12" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,system-ui,sans-serif" font-size="${fontSize}" font-weight="500" fill="#6f8bb5" opacity="0.85">${label}</text>` +
    `</svg>`;
  return vscode.Uri.parse('data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'));
}

function disposeAllDecorations() {
  for (const d of decorationsById.values()) d.dispose();
  decorationsById.clear();
}

function applyDecorations() {
  disposeAllDecorations();
  if (!store.pins.length) return;
  const root = workspaceRoot();
  if (!root) return;

  const byFile = new Map();
  for (const p of store.pins) {
    const full = path.join(root, p.file);
    if (!byFile.has(full)) byFile.set(full, []);
    byFile.get(full).push(p);
  }

  for (const ed of vscode.window.visibleTextEditors) {
    if (ed.document.uri.scheme !== 'file') continue;
    const pins = byFile.get(ed.document.uri.fsPath);
    if (!pins) continue;
    for (const p of pins) {
      const dec = vscode.window.createTextEditorDecorationType({
        gutterIconPath: makeGutterIcon(p.id),
        gutterIconSize: 'contain',
        overviewRulerColor: 'rgba(111, 139, 181, 0.35)',
        overviewRulerLane: vscode.OverviewRulerLane.Center
      });
      decorationsById.set(p.id, dec);
      const startLineIdx = Math.max(0, Math.min(p.startLine - 1, ed.document.lineCount - 1));
      const range = new vscode.Range(startLineIdx, 0, startLineIdx, 0);
      ed.setDecorations(dec, [range]);
    }
  }
}

function updateStatus() {
  if (!statusItem) return;
  if (store.pins.length === 0) {
    statusItem.hide();
    return;
  }
  statusItem.text = `$(bookmark) ${store.pins.length} pin${store.pins.length === 1 ? '' : 's'}`;
  statusItem.tooltip = 'CodeRef: click to open the sidebar';
  statusItem.command = 'workbench.view.extension.coderef';
  statusItem.show();
}

function reloadStore() {
  const root = workspaceRoot();
  if (!root) return;
  storePath = storeFilePath(root);
  store = load(storePath);
  treeProvider && treeProvider.refresh();
  applyDecorations();
  updateStatus();
}

function commitStore() {
  suppressNextWatcherEvent = true;
  save(storePath, store);
  treeProvider && treeProvider.refresh();
  applyDecorations();
  updateStatus();
}

async function pinSelection() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) { vscode.window.showWarningMessage('CodeRef: no active editor.'); return; }
  const root = workspaceRoot();
  if (!root) { vscode.window.showWarningMessage('CodeRef: open a folder first.'); return; }
  const sel = editor.selection;
  const startLine = sel.start.line + 1;
  let endLine = sel.end.line + 1;
  if (sel.end.character === 0 && endLine > startLine) endLine -= 1;
  const relPath = path.relative(root, editor.document.uri.fsPath);
  const pin = {
    id: store.nextId,
    file: relPath,
    startLine,
    endLine,
    createdAt: new Date().toISOString()
  };
  store.pins.push(pin);
  store.nextId += 1;
  commitStore();
  vscode.window.setStatusBarMessage(`Pinned as #${pin.id}`, 2000);
}

function clearAll() {
  store = defaultStore();
  commitStore();
}

function clearOne(item) {
  if (!item) return;
  const id = typeof item === 'number' ? item : (item.pin && item.pin.id);
  if (id == null) return;
  store.pins = store.pins.filter(p => p.id !== id);
  if (store.pins.length === 0) store.nextId = 1;
  commitStore();
}

async function jumpTo(arg) {
  const pin = arg && arg.pin ? arg.pin : arg;
  if (!pin || !pin.file) return;
  const root = workspaceRoot();
  if (!root) return;
  const uri = vscode.Uri.file(path.join(root, pin.file));
  try {
    const doc = await vscode.workspace.openTextDocument(uri);
    const ed = await vscode.window.showTextDocument(doc, { preview: false });
    const line = Math.max(0, Math.min(pin.startLine - 1, doc.lineCount - 1));
    const endLine = Math.max(0, Math.min(pin.endLine - 1, doc.lineCount - 1));
    const range = new vscode.Range(line, 0, endLine, doc.lineAt(endLine).text.length);
    ed.revealRange(range, vscode.TextEditorRevealType.InCenter);
    ed.selection = new vscode.Selection(range.start, range.end);
  } catch (e) {
    vscode.window.showWarningMessage(`CodeRef: cannot open ${pin.file}`);
  }
}

async function copyId(arg) {
  const pin = arg && arg.pin ? arg.pin : arg;
  if (!pin) return;
  await vscode.env.clipboard.writeText('#' + pin.id);
  vscode.window.setStatusBarMessage('Copied #' + pin.id, 1500);
}

class PinsProvider {
  constructor() {
    this._emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._emitter.event;
  }
  refresh() { this._emitter.fire(); }
  getTreeItem(elem) { return elem; }
  getChildren() {
    return store.pins.map(p => {
      const range = p.startLine === p.endLine ? String(p.startLine) : `${p.startLine}-${p.endLine}`;
      const item = new vscode.TreeItem(`#${p.id}  ${p.file}:${range}`, vscode.TreeItemCollapsibleState.None);
      item.contextValue = 'coderefPin';
      item.command = { command: 'coderef.jumpTo', title: 'Jump', arguments: [{ pin: p }] };
      item.pin = p;
      item.iconPath = new vscode.ThemeIcon('bookmark');
      item.tooltip = `${p.file}:${range}\nclick to jump`;
      return item;
    });
  }
}

function setupWatcher(context) {
  if (watcherDisposable) { watcherDisposable.dispose(); watcherDisposable = null; }
  const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
  if (!folder) return;
  const w = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(folder, '.vscode/coderef.json')
  );
  const onChange = () => {
    if (suppressNextWatcherEvent) { suppressNextWatcherEvent = false; return; }
    reloadStore();
  };
  w.onDidChange(onChange);
  w.onDidCreate(onChange);
  w.onDidDelete(onChange);
  watcherDisposable = w;
  context.subscriptions.push(w);
}

function activate(context) {
  treeProvider = new PinsProvider();
  context.subscriptions.push(vscode.window.registerTreeDataProvider('coderef.pins', treeProvider));

  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  context.subscriptions.push(statusItem);

  context.subscriptions.push(vscode.commands.registerCommand('coderef.pinSelection', pinSelection));
  context.subscriptions.push(vscode.commands.registerCommand('coderef.clearAll', clearAll));
  context.subscriptions.push(vscode.commands.registerCommand('coderef.clearOne', clearOne));
  context.subscriptions.push(vscode.commands.registerCommand('coderef.jumpTo', jumpTo));
  context.subscriptions.push(vscode.commands.registerCommand('coderef.copyId', copyId));
  context.subscriptions.push(vscode.commands.registerCommand('coderef.refresh', reloadStore));

  context.subscriptions.push(vscode.window.onDidChangeVisibleTextEditors(() => applyDecorations()));
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => {
    reloadStore();
    setupWatcher(context);
  }));

  reloadStore();
  setupWatcher(context);
}

function deactivate() {
  if (watcherDisposable) watcherDisposable.dispose();
  disposeAllDecorations();
}

module.exports = { activate, deactivate };
