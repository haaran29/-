// Electron の外（ブラウザ）で開いたときは localStorage で動く
const api = window.fusen || (() => {
  const key = 'fusen-preview';
  let note;
  try { note = JSON.parse(localStorage.getItem(key)); } catch {}
  note = note || { title: '', color: 'yellow', pinned: true, items: [] };
  const store = () => { try { localStorage.setItem(key, JSON.stringify(note)); } catch {} };
  return {
    get: async () => note,
    update: (patch) => { Object.assign(note, patch); store(); },
    newNote: () => {},
    remove: () => { note.items = []; note.title = ''; store(); location.reload(); },
    togglePin: async () => { note.pinned = !note.pinned; store(); return note.pinned; },
  };
})();

const COLORS = {
  yellow: '#fff6a6', pink: '#ffd9e3', blue: '#d3eaff',
  green: '#d9f5cd', purple: '#e8dcff', orange: '#ffe3c2',
};
const CHECK_SVG = '<svg viewBox="0 0 12 12"><path d="M2 6.5l2.6 2.5L10 3.2" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const $ = (id) => document.getElementById(id);
const list = $('list');
const addInput = $('addInput');
let items = [];
let rendering = false;

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const saveItems = () => api.update({ items });

function updateProgress() {
  const done = items.filter((i) => i.done).length;
  $('progress').textContent = items.length ? `${done} / ${items.length} 完了` : '';
  $('clear').classList.toggle('show', done > 0);
}

function render(focusId) {
  rendering = true;
  list.textContent = '';
  rendering = false;
  for (const item of items) {
    const li = document.createElement('li');
    li.classList.toggle('done', item.done);

    const check = document.createElement('button');
    check.className = 'check';
    check.title = item.done ? 'チェックを外す' : 'チェックを入れる';
    check.innerHTML = CHECK_SVG;
    check.addEventListener('click', () => {
      item.done = !item.done;
      saveItems();
      render();
    });

    const text = document.createElement('div');
    text.className = 'text';
    text.contentEditable = 'plaintext-only';
    text.textContent = item.text;
    text.addEventListener('input', () => {
      item.text = text.textContent;
      saveItems();
    });
    text.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        addInput.focus();
      } else if (e.key === 'Backspace' && text.textContent === '') {
        e.preventDefault();
        removeItem(item);
        addInput.focus();
      }
    });
    text.addEventListener('blur', () => {
      if (!rendering && item.text.trim() === '') removeItem(item);
    });

    const date = document.createElement('span');
    date.className = 'date';
    if (item.createdAt) {
      const d = new Date(item.createdAt);
      date.textContent = formatDate(d);
      date.title = '追加：' + d.toLocaleString('ja-JP', { dateStyle: 'long', timeStyle: 'short' });
    }

    const del = document.createElement('button');
    del.className = 'del';
    del.title = '消す';
    del.textContent = '✕';
    del.addEventListener('mousedown', (e) => e.preventDefault());
    del.addEventListener('click', () => removeItem(item));

    li.append(check, text, date, del);
    list.append(li);
    if (item.id === focusId) text.focus();
  }
  updateProgress();
}

// 今年なら「10/17」、それより前なら「2025/10/17」
function formatDate(d) {
  const md = `${d.getMonth() + 1}/${d.getDate()}`;
  return d.getFullYear() === new Date().getFullYear() ? md : `${d.getFullYear()}/${md}`;
}

function removeItem(item) {
  if (!items.includes(item)) return;
  items = items.filter((i) => i !== item);
  saveItems();
  render();
}

addInput.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.isComposing) return;
  const text = addInput.value.trim();
  if (!text) return;
  items.push({ id: uid(), text, done: false, createdAt: Date.now() });
  addInput.value = '';
  saveItems();
  render();
  addInput.scrollIntoView({ block: 'nearest' });
});

$('clear').addEventListener('click', () => {
  items = items.filter((i) => !i.done);
  saveItems();
  render();
});

$('title').addEventListener('input', (e) => api.update({ title: e.target.value }));
$('title').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.isComposing) addInput.focus();
});

// 色
const palette = $('palette');
for (const [name, hex] of Object.entries(COLORS)) {
  const b = document.createElement('button');
  b.style.background = hex;
  b.title = name;
  b.addEventListener('click', () => {
    document.body.dataset.color = name;
    api.update({ color: name });
    palette.classList.remove('open');
  });
  palette.append(b);
}
$('color').addEventListener('click', (e) => {
  e.stopPropagation();
  palette.classList.toggle('open');
});
document.addEventListener('click', (e) => {
  if (!palette.contains(e.target)) palette.classList.remove('open');
});

const showPin = (on) => {
  $('pin').classList.toggle('off', !on);
  $('pin').title = on ? 'いつも手前に表示：オン（押すとオフ）' : 'いつも手前に表示：オフ（押すとオン）';
};
$('pin').addEventListener('click', async () => showPin(await api.togglePin()));
$('new').addEventListener('click', () => api.newNote());
$('remove').addEventListener('click', () => {
  const hasContent = items.length > 0 || $('title').value.trim() !== '';
  if (!hasContent || confirm('この付箋を削除しますか？')) api.remove();
});

api.get().then((note) => {
  if (!note) return;
  items = Array.isArray(note.items) ? note.items : [];
  $('title').value = note.title || '';
  document.body.dataset.color = COLORS[note.color] ? note.color : 'yellow';
  showPin(note.pinned !== false);
  render();
  if (!items.length) addInput.focus();
});
