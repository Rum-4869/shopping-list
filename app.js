const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();

app.set('view engine', 'ejs');

// CSSや画像などの静的ファイルを配信できるようにする
app.use(express.static('public'));
app.use(express.json());

// ★新機能1：フォームから送られたデータを受け取るための魔法の設定
app.use(express.urlencoded({ extended: true }));

const DATA_DIR = path.join(__dirname, 'data');
const STORE_PATH = path.join(DATA_DIR, 'shopping-list.json');

function ensureStore() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STORE_PATH)) {
    fs.writeFileSync(STORE_PATH, JSON.stringify([
      { id: 1, name: '牛乳', done: false },
      { id: 2, name: '卵', done: false },
      { id: 3, name: '食パン', done: false },
      { id: 4, name: 'お肉', done: false }
    ], null, 2));
  }
}

function saveItems() {
  fs.writeFileSync(STORE_PATH, JSON.stringify(items, null, 2));
}

function loadItems() {
  ensureStore();
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => ({
        id: Number(item.id) || 0,
        name: String(item.name || '').trim(),
        done: Boolean(item.done)
      }))
      .filter((item) => item.id && item.name);
  } catch (error) {
    console.warn('保存データの読み込みに失敗しました。初期データで開始します。', error);
    return [];
  }
}

let nextId = 1;

function createItem(name, done = false) {
  const item = {
    id: nextId++,
    name: String(name).trim(),
    done: Boolean(done)
  };

  return item;
}

let items = loadItems();
nextId = items.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1;

function normalizeItem(item) {
  if (typeof item === 'string') {
    return { id: nextId++, name: item.trim(), done: false };
  }

  return {
    id: Number(item && item.id ? item.id : nextId++),
    name: String(item && item.name ? item.name : '').trim(),
    done: Boolean(item && item.done)
  };
}

function sanitizeItemName(value) {
  const name = String(value || '').trim();
  if (!name) return null;
  if (name.length > 30) return null;
  return name;
}

// ① 開始画面（GET）
app.get('/', (req, res) => {
  res.render('landing.ejs');
});

app.get('/list', (req, res) => {
  const normalizedItems = items.map(normalizeItem);
  res.render('index.ejs', { items: normalizedItems, activeTab: 'list' });
});

app.get('/notes', (req, res) => {
  res.render('notes.ejs', { activeTab: 'notes' });
});

app.get('/settings', (req, res) => {
  res.render('settings.ejs', { activeTab: 'settings' });
});

// ★新機能2：追加ボタンが押された時の処理（POST）
app.post('/add', (req, res) => {
  const newItemName = sanitizeItemName(req.body.itemName);
  if (!newItemName) {
    return res.redirect('/list');
  }

  const hasDuplicate = items.some((item) => {
    const normalized = normalizeItem(item).name.toLowerCase();
    return normalized === newItemName.toLowerCase();
  });

  if (hasDuplicate) {
    return res.redirect('/list');
  }

  items.push(createItem(newItemName));
  saveItems();
  res.redirect('/list');
});

app.post('/toggle/:id', (req, res) => {
  const id = Number(req.params.id);
  const target = items.find((item) => item.id === id);
  if (target) {
    target.done = !target.done;
    saveItems();
  }
  res.redirect('/list');
});

app.post('/reorder', (req, res) => {
  const order = Array.isArray(req.body.order) ? req.body.order : [];
  if (order.length === 0) {
    return res.status(400).json({ ok: false, message: 'order is required' });
  }

  const ids = order.map(Number).filter((id) => Number.isInteger(id));
  const currentItems = items.map(normalizeItem);
  const orderedItems = ids
    .map((id) => currentItems.find((item) => item.id === id))
    .filter(Boolean);

  const remainingItems = currentItems.filter((item) => !ids.includes(item.id));
  items = [...orderedItems, ...remainingItems];
  saveItems();

  res.json({ ok: true, items: items.map(normalizeItem) });
});

// ★新機能3：削除ボタンが押された時の処理（POST）
app.post('/delete/:id', (req, res) => {
  const id = Number(req.params.id);
  items = items.filter((item) => item.id !== id);
  saveItems();
  res.redirect('/list');
});

// サーバー起動
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`サーバーが ${port} 番ポートで起動しました！`);
});