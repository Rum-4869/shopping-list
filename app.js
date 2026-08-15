const express = require('express');
const app = express();

app.set('view engine', 'ejs');

// CSSや画像などの静的ファイルを配信できるようにする
app.use(express.static('public'));

// ★新機能1：フォームから送られたデータを受け取るための魔法の設定
app.use(express.urlencoded({ extended: true }));

// 変数宣言を「const」から「let」に変更して、中身を書き換えられるようにします
let items = [
  { name: '牛乳', done: false },
  { name: '卵', done: false },
  { name: '食パン', done: false },
  { name: 'お肉', done: false }
];

function normalizeItem(item) {
  if (typeof item === 'string') {
    return { name: item.trim(), done: false };
  }

  return {
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
  res.render('index.ejs', { items: normalizedItems });
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

  items.push({ name: newItemName, done: false });
  res.redirect('/list');
});

app.post('/toggle/:id', (req, res) => {
  const id = Number(req.params.id);
  if (Number.isInteger(id) && items[id]) {
    items[id].done = !items[id].done;
  }
  res.redirect('/list');
});

// ★新機能3：削除ボタンが押された時の処理（POST）
app.post('/delete/:id', (req, res) => {
  const id = Number(req.params.id);
  if (Number.isInteger(id) && items[id]) {
    items.splice(id, 1);
  }
  res.redirect('/list');
});

// サーバー起動
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`サーバーが ${port} 番ポートで起動しました！`);
});