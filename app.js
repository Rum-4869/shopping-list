const express = require('express');
const app = express();

app.set('view engine', 'ejs');

// CSSや画像などの静的ファイルを配信できるようにする
app.use(express.static('public'));

// ★新機能1：フォームから送られたデータを受け取るための魔法の設定
app.use(express.urlencoded({ extended: true }));

// 変数宣言を「const」から「let」に変更して、中身を書き換えられるようにします
let items = ['牛乳', '卵', '食パン', 'お肉'];

// ① 一覧表示の処理（GET）
app.get('/', (req, res) => {
  res.render('index.ejs', { items: items });
});

// ★新機能2：追加ボタンが押された時の処理（POST）
app.post('/add', (req, res) => {
  const newItem = req.body.itemName; // フォームに入力された文字をキャッチ！
  items.push(newItem);               // 配列の一番後ろにドカンと追加！
  res.redirect('/');                 // 処理が終わったらトップページに強制移動（リロード）させる
});

// ★新機能3：削除ボタンが押された時の処理（POST）
app.post('/delete/:id', (req, res) => {
  const id = req.params.id; // URLから「何番目のアイテムか」という数字をキャッチ！
  items.splice(id, 1);      // 配列からその番号のアイテムを1つ削除！
  res.redirect('/');        // トップページに戻る
});

// サーバー起動
app.listen(3000, () => {
  console.log('サーバーが3000番ポートで起動しました！');
});