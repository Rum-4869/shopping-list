require('dotenv').config();
const express = require('express');
const app = express();
const db = require('./db');

app.set('view engine', 'ejs');

// CSSや画像などの静的ファイルを配信できるようにする
app.use(express.static('public'));
app.use(express.json());

// フォームから送られたデータを受け取る
app.use(express.urlencoded({ extended: true }));

const USER_COOKIE_NAME = 'shopping_user_id';
const ROOM_COOKIE_NAME = 'shopping_room_id';

function getCookieValue(req, cookieName) {
  const cookieHeader = req.headers.cookie || '';
  const cookie = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName}=`));

  if (!cookie) return null;
  return decodeURIComponent(cookie.slice(cookieName.length + 1));
}

function generateUserId() {
  return `user-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function sanitizeRoomName(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  // 最大30文字
  return trimmed.slice(0, 30);
}

function ensureUserSession(req, res) {
  let userId = getCookieValue(req, USER_COOKIE_NAME);
  if (!userId) {
    userId = generateUserId();
    res.cookie(USER_COOKIE_NAME, userId, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 365 * 24 * 60 * 60 * 1000
    });
  }

  // URLクエリに ?room=xxxx または ?share=xxxx が指定されていれば合言葉を適用
  const queryRoom = req.query.room || req.query.share;
  if (queryRoom) {
    const sanitized = sanitizeRoomName(queryRoom);
    if (sanitized) {
      res.cookie(ROOM_COOKIE_NAME, sanitized, {
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 365 * 24 * 60 * 60 * 1000
      });
      req.roomName = sanitized;
    }
  } else {
    req.roomName = getCookieValue(req, ROOM_COOKIE_NAME) || null;
  }

  if (req.roomName) {
    // 共有ルームモード
    req.userId = `room:${req.roomName}`;
    req.isShared = true;
  } else {
    // 個人モード
    req.userId = userId;
    req.isShared = false;
  }
}

app.use((req, res, next) => {
  ensureUserSession(req, res);
  next();
});

function isJsonRequest(req) {
  const accept = String(req.headers.accept || '');
  return accept.includes('application/json') || req.xhr || req.get('X-Requested-With') === 'XMLHttpRequest';
}

// ① 開始画面（GET）
app.get('/', (req, res) => {
  res.render('landing.ejs', { isShared: req.isShared, roomName: req.roomName });
});

// リスト画面（GET）
app.get('/list', async (req, res, next) => {
  try {
    const items = await db.loadItemsForUser(req.userId);
    const presets = await db.getPresetsForUser(req.userId);
    res.render('index.ejs', {
      items,
      presets,
      activeTab: 'list',
      isShared: req.isShared,
      roomName: req.roomName
    });
  } catch (error) {
    next(error);
  }
});

// よく買うもの（プリセット）追加（POST）
app.post('/presets/add', async (req, res, next) => {
  try {
    const userId = req.userId;
    const name = req.body.name;
    const icon = req.body.icon || null;
    const result = await db.addPreset(userId, name, icon);

    if (!result.ok) {
      if (isJsonRequest(req)) {
        return res.status(result.status || 400).json({ ok: false, message: result.message });
      }
      return res.redirect('/list');
    }

    if (isJsonRequest(req)) {
      return res.json({ ok: true, preset: result.preset });
    }

    res.redirect('/list');
  } catch (error) {
    next(error);
  }
});

// よく買うもの（プリセット）削除（POST）
app.post('/presets/delete/:id', async (req, res, next) => {
  try {
    const userId = req.userId;
    const result = await db.deletePreset(userId, req.params.id);

    if (isJsonRequest(req)) {
      return res.json({ ok: true, deleted: result.deleted, id: result.id });
    }

    res.redirect('/list');
  } catch (error) {
    next(error);
  }
});


// メモ画面（GET）
app.get('/notes', async (req, res, next) => {
  try {
    const note = await db.getNoteForUser(req.userId);
    res.render('notes.ejs', {
      note,
      activeTab: 'notes',
      isShared: req.isShared,
      roomName: req.roomName
    });
  } catch (error) {
    next(error);
  }
});

// メモ保存（POST）
app.post('/notes', async (req, res, next) => {
  try {
    const content = req.body.content || '';
    await db.saveNoteForUser(req.userId, content);

    if (isJsonRequest(req)) {
      return res.json({ ok: true });
    }

    res.redirect('/notes');
  } catch (error) {
    next(error);
  }
});

// 設定画面（GET）
app.get('/settings', (req, res) => {
  res.render('settings.ejs', {
    activeTab: 'settings',
    isShared: req.isShared,
    roomName: req.roomName
  });
});

// 共有ルームへの参加・作成（POST）
app.post('/share/join', (req, res) => {
  const roomName = sanitizeRoomName(req.body.roomName);
  if (!roomName) {
    if (isJsonRequest(req)) {
      return res.status(400).json({ ok: false, message: '合言葉を入力してください' });
    }
    return res.redirect('/settings');
  }

  res.cookie(ROOM_COOKIE_NAME, roomName, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 365 * 24 * 60 * 60 * 1000
  });

  if (isJsonRequest(req)) {
    return res.json({ ok: true, roomName });
  }

  res.redirect('/list');
});

// 共有ルームからの退出・個人モードへの復帰（POST）
app.post('/share/leave', (req, res) => {
  res.clearCookie(ROOM_COOKIE_NAME);

  if (isJsonRequest(req)) {
    return res.json({ ok: true });
  }

  res.redirect('/list');
});

// 追加ボタンが押された時の処理（POST）
app.post('/add', async (req, res, next) => {
  try {
    const userId = req.userId;
    const itemName = req.body.itemName;
    const result = await db.addItem(userId, itemName);

    if (!result.ok) {
      if (isJsonRequest(req)) {
        return res.status(result.status || 400).json({ ok: false, message: result.message });
      }
      return res.redirect('/list');
    }

    if (isJsonRequest(req)) {
      return res.json({ ok: true, item: result.item });
    }

    res.redirect('/list');
  } catch (error) {
    next(error);
  }
});

// 完了/未完了の切り替え（POST）
app.post('/toggle/:id', async (req, res, next) => {
  try {
    const userId = req.userId;
    const result = await db.toggleItem(userId, req.params.id);

    if (result.ok) {
      if (isJsonRequest(req)) {
        return res.json({ ok: true, item: result.item });
      }
    } else if (isJsonRequest(req)) {
      return res.status(result.status || 404).json({ ok: false, message: result.message });
    }

    res.redirect('/list');
  } catch (error) {
    next(error);
  }
});

// 並び替えの保存（POST）
app.post('/reorder', async (req, res, next) => {
  try {
    const userId = req.userId;
    const result = await db.reorderItems(userId, req.body.order);

    if (!result.ok) {
      return res.status(result.status || 400).json({ ok: false, message: result.message });
    }

    res.json({ ok: true, items: result.items });
  } catch (error) {
    next(error);
  }
});

// アイテムの削除（POST）
app.post('/delete/:id', async (req, res, next) => {
  try {
    const userId = req.userId;
    const result = await db.deleteItem(userId, req.params.id);

    if (isJsonRequest(req)) {
      return res.json({ ok: true, deleted: result.deleted, id: result.id });
    }

    res.redirect('/list');
  } catch (error) {
    next(error);
  }
});

// 購入済みアイテムの一括削除（POST）
app.post('/clear-completed', async (req, res, next) => {
  try {
    const userId = req.userId;
    const result = await db.deleteCompletedItems(userId);

    if (isJsonRequest(req)) {
      return res.json({ ok: true, count: result.count });
    }

    res.redirect('/list');
  } catch (error) {
    next(error);
  }
});

// エラーハンドラー
app.use((err, req, res, next) => {
  console.error('サーバーエラー:', err);
  if (isJsonRequest(req)) {
    return res.status(500).json({ ok: false, message: 'Internal Server Error' });
  }
  res.status(500).send('サーバーエラーが発生しました');
});

module.exports = app;

if (require.main === module) {
  const port = process.env.PORT || 3000;
  db.initDatabase()
    .then(() => {
      app.listen(port, () => {
        console.log(`サーバーが ${port} 番ポートで起動しました！`);
      });
    })
    .catch((err) => {
      console.error('データベースの初期化に失敗しました:', err);
      process.exit(1);
    });
}