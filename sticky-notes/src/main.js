// 付箋TODO：メインプロセス
// 付箋ごとに枠なし・常に最前面のウィンドウを1つ開き、内容と位置を notes.json に保存する。
const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const COLORS = ['yellow', 'pink', 'blue', 'green', 'purple', 'orange'];
const DEFAULT_SIZE = { width: 290, height: 188 };

let dataFile;
let notes = [];
const windows = new Map(); // noteId -> BrowserWindow
let tray = null;
let saveTimer = null;

// ---------- 保存と読み込み ----------
function load() {
  try {
    const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    notes = Array.isArray(data.notes) ? data.notes : [];
  } catch {
    notes = [];
  }
}

function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  const json = JSON.stringify({ version: 1, notes }, null, 2);
  try {
    fs.mkdirSync(path.dirname(dataFile), { recursive: true });
    const tmp = dataFile + '.tmp';
    fs.writeFileSync(tmp, json);
    try {
      fs.renameSync(tmp, dataFile);
    } catch {
      // Windows ではウイルス対策ソフトなどがファイルをつかんでいて置き換えられないことがある
      fs.writeFileSync(dataFile, json);
      fs.rmSync(tmp, { force: true });
    }
  } catch (err) {
    logError(err);
    saveTimer = setTimeout(saveNow, 2000); // 少し待ってもう一度
  }
}

// エラーの画面を出さずに error.log に書いておく
function logError(err) {
  try {
    const line = `[${new Date().toLocaleString('ja-JP')}] ${err && err.stack || err}\n`;
    fs.appendFileSync(path.join(app.getPath('userData'), 'error.log'), line);
  } catch {}
}
process.on('uncaughtException', logError);
process.on('unhandledRejection', logError);

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 300);
}

function findNote(id) {
  return notes.find((n) => n.id === id);
}

function newNote(near) {
  const area = screen.getPrimaryDisplay().workArea;
  let x = area.x + area.width - DEFAULT_SIZE.width - 40;
  let y = area.y + 40;
  if (near) {
    x = near.x + 30;
    y = near.y + 30;
  }
  const note = {
    id: crypto.randomUUID(),
    title: '',
    color: near ? COLORS[(COLORS.indexOf(near.color) + 1) % COLORS.length] : 'yellow',
    pinned: true,
    items: [],
    x,
    y,
    ...DEFAULT_SIZE,
  };
  notes.push(note);
  save();
  return note;
}

// 画面の外に出てしまった付箋（モニターを外したときなど）を見える位置へ戻す
function keepOnScreen(note) {
  const visible = screen.getAllDisplays().some(({ workArea: a }) =>
    note.x < a.x + a.width - 40 && note.x + note.width > a.x + 40 &&
    note.y >= a.y - 10 && note.y < a.y + a.height - 40);
  if (!visible) {
    const a = screen.getPrimaryDisplay().workArea;
    note.x = a.x + a.width - note.width - 40;
    note.y = a.y + 40;
  }
}

// ---------- ウィンドウ ----------
function openNoteWindow(note) {
  if (windows.has(note.id)) {
    windows.get(note.id).show();
    return windows.get(note.id);
  }
  keepOnScreen(note);
  const win = new BrowserWindow({
    x: note.x,
    y: note.y,
    width: note.width,
    height: note.height,
    minWidth: 180,
    minHeight: 120,
    frame: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: note.pinned,
    show: false,
    title: '付箋',
    backgroundColor: '#fff6a6',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (note.pinned) win.setAlwaysOnTop(true, 'floating');
  win.noteId = note.id;
  windows.set(note.id, win);

  win.loadFile(path.join(__dirname, 'index.html'), { query: { id: note.id } });
  win.once('ready-to-show', () => win.showInactive());

  const remember = () => {
    const n = findNote(note.id);
    if (!n || win.isDestroyed()) return;
    Object.assign(n, win.getBounds());
    save();
  };
  win.on('moved', remember);
  win.on('resized', remember);
  win.on('closed', () => windows.delete(note.id));
  return win;
}

function showAll() {
  if (notes.length === 0) newNote();
  notes.forEach((n) => openNoteWindow(n).show());
}

function noteOf(event) {
  const win = BrowserWindow.fromWebContents(event.sender);
  return win && findNote(win.noteId);
}

// ---------- 画面とのやりとり ----------
ipcMain.handle('note:get', (event) => noteOf(event) || null);

ipcMain.on('note:update', (event, patch) => {
  const note = noteOf(event);
  if (!note) return;
  for (const key of ['title', 'color', 'items']) {
    if (key in patch) note[key] = patch[key];
  }
  save();
});

ipcMain.on('note:new', (event) => {
  openNoteWindow(newNote(noteOf(event)));
});

ipcMain.on('note:delete', (event) => {
  const note = noteOf(event);
  if (!note) return;
  notes = notes.filter((n) => n.id !== note.id);
  saveNow();
  const win = windows.get(note.id);
  if (win) win.close();
});

ipcMain.handle('note:togglePin', (event) => {
  const note = noteOf(event);
  if (!note) return false;
  note.pinned = !note.pinned;
  windows.get(note.id).setAlwaysOnTop(note.pinned, 'floating');
  save();
  return note.pinned;
});

// ---------- タスクトレイ ----------
function loginPath() {
  // ポータブル版は一時フォルダから動くので、元の exe の場所を登録する
  return process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
}

function buildTrayMenu() {
  const openAtLogin = app.getLoginItemSettings({ path: loginPath() }).openAtLogin;
  return Menu.buildFromTemplate([
    { label: `付箋TODO（版 ${app.getVersion()}）`, enabled: false },
    { type: 'separator' },
    { label: '新しい付箋', click: () => openNoteWindow(newNote()) },
    { label: 'すべての付箋を表示', click: showAll },
    { type: 'separator' },
    {
      label: 'パソコン起動時に開く',
      type: 'checkbox',
      checked: openAtLogin,
      click: (item) => {
        app.setLoginItemSettings({ openAtLogin: item.checked, path: loginPath() });
        tray.setContextMenu(buildTrayMenu());
      },
    },
    { type: 'separator' },
    { label: '終了', click: () => app.quit() },
  ]);
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'tray.png'));
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip(`付箋TODO ${app.getVersion()}`);
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', showAll);
}

// ---------- 起動 ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showAll);

  app.whenReady().then(() => {
    dataFile = path.join(app.getPath('userData'), 'notes.json');
    load();
    if (process.platform === 'darwin' && app.dock) app.dock.hide();
    createTray();
    showAll();
  });

  // 付箋をすべて閉じてもトレイに残す
  app.on('window-all-closed', () => {});
  app.on('before-quit', () => {
    if (saveTimer) saveNow();
  });
}
