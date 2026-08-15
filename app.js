const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();

app.set('view engine', 'ejs');

// CSSや画像などの静的ファイルを配信できるようにする
app.use(express.static('public'));
app.use(express.json());

// フォームから送られたデータを受け取る
app.use(express.urlencoded({ extended: true }));

const DATA_DIR = path.join(__dirname, 'data');
const USERS_DIR = path.join(DATA_DIR, 'users');
const USER_COOKIE_NAME = 'shopping_user_id';

function sanitizeUserId(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '_') || 'guest';
}

function ensureUserStore() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(USERS_DIR, { recursive: true });
}

function getUserIdFromCookie(req) {
  const cookieHeader = req.headers.cookie || '';
  const cookie = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${USER_COOKIE_NAME}=`));

  if (!cookie) return null;
  return decodeURIComponent(cookie.slice(USER_COOKIE_NAME.length + 1));
}

function generateUserId() {
  return `user-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function ensureUserSession(req, res) {
  let userId = getUserIdFromCookie(req);
  if (!userId) {
    userId = generateUserId();
    res.cookie(USER_COOKIE_NAME, userId, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 365 * 24 * 60 * 60 * 1000
    });
  }

  req.userId = userId;
}

app.use((req, res, next) => {
  ensureUserSession(req, res);
  next();
});

function createDefaultItems() {
  return [
    { id: 1, name: '牛乳', done: false },
    { id: 2, name: '卵', done: false },
    { id: 3, name: '食パン', done: false },
    { id: 4, name: 'お肉', done: false }
  ];
}

function getStorePath(userId) {
  ensureUserStore();
  return path.join(USERS_DIR, `${sanitizeUserId(userId)}.json`);
}

function saveItemsForUser(userId, items) {
  fs.writeFileSync(getStorePath(userId), JSON.stringify(items, null, 2));
}

function loadItemsForUser(userId) {
  const storePath = getStorePath(userId);

  if (!fs.existsSync(storePath)) {
    const initialItems = createDefaultItems();
    saveItemsForUser(userId, initialItems);
    return initialItems;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(storePath, 'utf8'));
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

function normalizeItem(item) {
  if (typeof item === 'string') {
    return { id: Date.now() + Math.random(), name: item.trim(), done: false };
  }

  return {
    id: Number(item && item.id ? item.id : 0),
    name: String(item && item.name ? item.name : '').trim(),
    done: Boolean(item && item.done)
  };
}

function createItem(name, nextId, done = false) {
  return {
    id: nextId,
    name: String(name).trim(),
    done: Boolean(done)
  };
}

function sanitizeItemName(value) {
  const name = String(value || '').trim();
  if (!name) return null;
  if (name.length > 30) return null;
  return name;
}

function isJsonRequest(req) {
  const accept = String(req.headers.accept || '');
  return accept.includes('application/json') || req.xhr || req.get('X-Requested-With') === 'XMLHttpRequest';
}

// ① 開始画面（GET）
app.get('/', (req, res) => {
  res.render('landing.ejs');
});

app.get('/list', (req, res) => {
  const items = loadItemsForUser(req.userId);
  const normalizedItems = items.map(normalizeItem);
  res.render('index.ejs', { items: normalizedItems, activeTab: 'list' });
});

app.get('/notes', (req, res) => {
  res.render('notes.ejs', { activeTab: 'notes' });
});

app.get('/settings', (req, res) => {
  res.render('settings.ejs', { activeTab: 'settings' });
});

// 追加ボタンが押された時の処理（POST）
app.post('/add', (req, res) => {
  const userId = req.userId;
  const newItemName = sanitizeItemName(req.body.itemName);
  if (!newItemName) {
    if (isJsonRequest(req)) {
      return res.status(400).json({ ok: false, message: 'invalid item name' });
    }
    return res.redirect('/list');
  }

  const items = loadItemsForUser(userId);
  const hasDuplicate = items.some((item) => {
    return normalizeItem(item).name.toLowerCase() === newItemName.toLowerCase();
  });

  if (hasDuplicate) {
    if (isJsonRequest(req)) {
      return res.status(409).json({ ok: false, message: 'duplicate item' });
    }
    return res.redirect('/list');
  }

  const nextId = items.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1;
  const item = createItem(newItemName, nextId);
  items.push(item);
  saveItemsForUser(userId, items);

  if (isJsonRequest(req)) {
    return res.json({ ok: true, item });
  }

  res.redirect('/list');
});

app.post('/toggle/:id', (req, res) => {
  const userId = req.userId;
  const id = Number(req.params.id);
  const items = loadItemsForUser(userId);
  const target = items.find((item) => item.id === id);

  if (target) {
    target.done = !target.done;
    saveItemsForUser(userId, items);
    if (isJsonRequest(req)) {
      return res.json({ ok: true, item: target });
    }
  } else if (isJsonRequest(req)) {
    return res.status(404).json({ ok: false, message: 'item not found' });
  }
  res.redirect('/list');
});

app.post('/reorder', (req, res) => {
  const userId = req.userId;
  const order = Array.isArray(req.body.order) ? req.body.order : [];
  if (order.length === 0) {
    return res.status(400).json({ ok: false, message: 'order is required' });
  }

  const items = loadItemsForUser(userId);
  const ids = order.map(Number).filter((id) => Number.isInteger(id));
  const currentItems = items.map(normalizeItem);
  const orderedItems = ids
    .map((id) => currentItems.find((item) => item.id === id))
    .filter(Boolean);

  const remainingItems = currentItems.filter((item) => !ids.includes(item.id));
  const reordered = [...orderedItems, ...remainingItems];
  saveItemsForUser(userId, reordered);

  res.json({ ok: true, items: reordered.map(normalizeItem) });
});

app.post('/delete/:id', (req, res) => {
  const userId = req.userId;
  const id = Number(req.params.id);
  const items = loadItemsForUser(userId);
  const target = items.find((item) => item.id === id);
  const filteredItems = items.filter((item) => item.id !== id);
  saveItemsForUser(userId, filteredItems);

  if (isJsonRequest(req)) {
    return res.json({ ok: true, deleted: Boolean(target), id });
  }

  res.redirect('/list');
});

module.exports = app;

if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`サーバーが ${port} 番ポートで起動しました！`);
  });
}