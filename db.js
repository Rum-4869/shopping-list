require('dotenv').config();
const mysql = require('mysql2/promise');

let pool = null;

function getPool() {
  if (!pool) {
    if (!process.env.TIDB_HOST && !process.env.DATABASE_URL) {
      throw new Error(
        '【環境変数が未設定です】TIDB_HOST が見つかりません。デプロイ先（Render等）のダッシュボードで Environment Variables を設定してください。'
      );
    }

    const sslConfig =
      process.env.TIDB_ENABLE_SSL === 'false'
        ? undefined
        : { minVersion: 'TLSv1.2', rejectUnauthorized: true };

    if (process.env.DATABASE_URL) {
      pool = mysql.createPool({
        uri: process.env.DATABASE_URL,
        ssl: sslConfig,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
      });
    } else {
      pool = mysql.createPool({
        host: process.env.TIDB_HOST,
        port: Number(process.env.TIDB_PORT) || 4000,
        user: process.env.TIDB_USER,
        password: process.env.TIDB_PASSWORD,
        database: process.env.TIDB_DATABASE || 'test',
        ssl: sslConfig,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
      });
    }
  }
  return pool;
}

const DEFAULT_ITEMS = ['牛乳', '卵', '食パン', 'お肉'];
const DEFAULT_PRESETS = [
  { name: '牛乳', icon: '🥛' },
  { name: '卵', icon: '🥚' },
  { name: '食パン', icon: '🍞' },
  { name: '玉ねぎ', icon: '🧅' },
  { name: 'お肉', icon: '🥩' },
  { name: 'バナナ', icon: '🍌' },
  { name: '日用品', icon: '🧻' }
];

async function initDatabase() {
  const currentPool = getPool();

  // ユーザー管理テーブル（初回来訪判定用）
  await currentPool.query(`
    CREATE TABLE IF NOT EXISTS shopping_users (
      user_id VARCHAR(64) PRIMARY KEY,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // アイテムテーブル
  await currentPool.query(`
    CREATE TABLE IF NOT EXISTS shopping_items (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(64) NOT NULL,
      name VARCHAR(255) NOT NULL,
      done TINYINT(1) DEFAULT 0,
      quantity INT DEFAULT 1,
      display_order INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_user_id (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  try {
    await currentPool.query('ALTER TABLE shopping_items ADD COLUMN quantity INT DEFAULT 1 AFTER done');
  } catch (err) {
    if (err.code !== 'ER_DUP_FIELDNAME') console.error('Failed to add quantity column:', err);
  }

  try {
    await currentPool.query('ALTER TABLE shopping_users ADD COLUMN display_name VARCHAR(255) DEFAULT NULL');
  } catch (err) {
    if (err.code !== 'ER_DUP_FIELDNAME') console.error('Failed to add display_name column:', err);
  }

  try {
    await currentPool.query('ALTER TABLE shopping_items ADD COLUMN added_by VARCHAR(64) DEFAULT NULL');
  } catch (err) {
    if (err.code !== 'ER_DUP_FIELDNAME') console.error('Failed to add added_by column:', err);
  }

  // メモ帳テーブル
  await currentPool.query(`
    CREATE TABLE IF NOT EXISTS shopping_notes (
      user_id VARCHAR(64) PRIMARY KEY,
      content TEXT,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // よく買うもの（プリセット）テーブル
  await currentPool.query(`
    CREATE TABLE IF NOT EXISTS shopping_presets (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(64) NOT NULL,
      name VARCHAR(255) NOT NULL,
      icon VARCHAR(16) DEFAULT '🛒',
      display_order INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_user_id (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

async function ensureUserInitialized(userId) {
  const currentPool = getPool();

  const [users] = await currentPool.query(
    'SELECT user_id FROM shopping_users WHERE user_id = ? LIMIT 1',
    [userId]
  );

  if (users.length === 0) {
    await currentPool.query(
      'INSERT IGNORE INTO shopping_users (user_id) VALUES (?)',
      [userId]
    );

    // 初回デフォルトアイテムを投入
    for (let i = 0; i < DEFAULT_ITEMS.length; i++) {
      await currentPool.query(
        'INSERT INTO shopping_items (user_id, name, done, display_order) VALUES (?, ?, 0, ?)',
        [userId, DEFAULT_ITEMS[i], i + 1]
      );
    }

    // 初回デフォルトプリセット（よく買うもの）を投入
    for (let i = 0; i < DEFAULT_PRESETS.length; i++) {
      await currentPool.query(
        'INSERT INTO shopping_presets (user_id, name, icon, display_order) VALUES (?, ?, ?, ?)',
        [userId, DEFAULT_PRESETS[i].name, DEFAULT_PRESETS[i].icon, i + 1]
      );
    }
  }
}


async function loadItemsForUser(userId) {
  const currentPool = getPool();
  await ensureUserInitialized(userId);

  const [rows] = await currentPool.query(
    `SELECT i.id, i.name, i.done, i.quantity, i.display_order, u.display_name AS addedByName
     FROM shopping_items i
     LEFT JOIN shopping_users u ON i.added_by = u.user_id
     WHERE i.user_id = ?
     ORDER BY i.display_order ASC, i.id ASC`,
    [userId]
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    done: Boolean(row.done),
    quantity: row.quantity || 1,
    addedByName: row.addedByName || ''
  }));
}

async function addItem(userId, name, realUserId = null) {
  const currentPool = getPool();
  await ensureUserInitialized(userId);
  if (realUserId) await ensureUserInitialized(realUserId);

  const trimmedName = String(name || '').trim();
  if (!trimmedName || trimmedName.length > 30) {
    return { ok: false, status: 400, message: 'invalid item name' };
  }

  // 重複チェック
  const [existing] = await currentPool.query(
    'SELECT id FROM shopping_items WHERE user_id = ? AND LOWER(name) = LOWER(?) LIMIT 1',
    [userId, trimmedName]
  );

  if (existing.length > 0) {
    return { ok: false, status: 409, message: 'duplicate item' };
  }

  // 最大display_orderを取得
  const [orderResult] = await currentPool.query(
    'SELECT COALESCE(MAX(display_order), 0) AS max_order FROM shopping_items WHERE user_id = ?',
    [userId]
  );
  const nextOrder = (orderResult[0]?.max_order || 0) + 1;

  const [insertResult] = await currentPool.query(
    'INSERT INTO shopping_items (user_id, name, done, display_order, added_by) VALUES (?, ?, 0, ?, ?)',
    [userId, trimmedName, nextOrder, realUserId || null]
  );

  let addedByName = '';
  if (realUserId) {
    const [u] = await currentPool.query('SELECT display_name FROM shopping_users WHERE user_id = ? LIMIT 1', [realUserId]);
    if (u.length > 0) addedByName = u[0].display_name || '';
  }

  const newItem = {
    id: insertResult.insertId,
    name: trimmedName,
    done: false,
    quantity: 1,
    addedByName
  };

  return { ok: true, item: newItem };
}

async function toggleItem(userId, itemId) {
  const currentPool = getPool();
  const id = Number(itemId);
  if (!id) return { ok: false, status: 404, message: 'invalid item id' };

  const [rows] = await currentPool.query(
    'SELECT id, name, done FROM shopping_items WHERE user_id = ? AND id = ? LIMIT 1',
    [userId, id]
  );

  if (rows.length === 0) {
    return { ok: false, status: 404, message: 'item not found' };
  }

  const newDone = rows[0].done ? 0 : 1;

  await currentPool.query(
    'UPDATE shopping_items SET done = ? WHERE user_id = ? AND id = ?',
    [newDone, userId, id]
  );

  return {
    ok: true,
    item: {
      id: rows[0].id,
      name: rows[0].name,
      done: Boolean(newDone),
      quantity: rows[0].quantity || 1
    }
  };
}

async function updateQuantity(userId, itemId, delta) {
  const currentPool = getPool();
  const id = Number(itemId);
  const d = Number(delta);
  if (!id) return { ok: false, status: 404, message: 'invalid item id' };

  const [rows] = await currentPool.query(
    'SELECT id, name, done, quantity FROM shopping_items WHERE user_id = ? AND id = ? LIMIT 1',
    [userId, id]
  );

  if (rows.length === 0) {
    return { ok: false, status: 404, message: 'item not found' };
  }

  let newQuantity = (rows[0].quantity || 1) + d;
  if (newQuantity < 1) newQuantity = 1;

  await currentPool.query(
    'UPDATE shopping_items SET quantity = ? WHERE user_id = ? AND id = ?',
    [newQuantity, userId, id]
  );

  return {
    ok: true,
    item: {
      id: rows[0].id,
      name: rows[0].name,
      done: Boolean(rows[0].done),
      quantity: newQuantity
    }
  };
}

async function reorderItems(userId, orderedIds) {
  const currentPool = getPool();
  const ids = (Array.isArray(orderedIds) ? orderedIds : [])
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0);

  if (ids.length === 0) {
    return { ok: false, status: 400, message: 'order is required' };
  }

  // 順番通りにdisplay_orderを更新
  for (let i = 0; i < ids.length; i++) {
    await currentPool.query(
      'UPDATE shopping_items SET display_order = ? WHERE user_id = ? AND id = ?',
      [i + 1, userId, ids[i]]
    );
  }

  const updatedItems = await loadItemsForUser(userId);
  return { ok: true, items: updatedItems };
}

async function deleteItem(userId, itemId) {
  const currentPool = getPool();
  const id = Number(itemId);
  if (!id) return { ok: false, status: 404, message: 'invalid item id' };

  const [result] = await currentPool.query(
    'DELETE FROM shopping_items WHERE user_id = ? AND id = ?',
    [userId, id]
  );

  return {
    ok: true,
    deleted: result.affectedRows > 0,
    id
  };
}

async function deleteCompletedItems(userId) {
  const currentPool = getPool();
  const [result] = await currentPool.query(
    'DELETE FROM shopping_items WHERE user_id = ? AND done = 1',
    [userId]
  );

  return {
    ok: true,
    count: result.affectedRows || 0
  };
}

async function getNoteForUser(userId) {
  const currentPool = getPool();
  const [rows] = await currentPool.query(
    'SELECT content, updated_at FROM shopping_notes WHERE user_id = ? LIMIT 1',
    [userId]
  );

  return rows.length > 0 ? rows[0].content : '';
}

async function saveNoteForUser(userId, content) {
  const currentPool = getPool();
  const textContent = String(content || '');

  await currentPool.query(
    `INSERT INTO shopping_notes (user_id, content)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE content = VALUES(content), updated_at = CURRENT_TIMESTAMP`,
    [userId, textContent]
  );

  return { ok: true };
}

function detectIcon(name) {
  const text = String(name || '').toLowerCase();
  if (text.includes('牛乳') || text.includes('ミルク')) return '🥛';
  if (text.includes('卵') || text.includes('たまご')) return '🥚';
  if (text.includes('パン')) return '🍞';
  if (text.includes('肉') || text.includes('チキン') || text.includes('ポーク') || text.includes('ビーフ') || text.includes('牛') || text.includes('豚') || text.includes('鶏')) return '🥩';
  if (text.includes('魚') || text.includes('サーモン') || text.includes('刺身')) return '🐟';
  if (text.includes('野菜') || text.includes('サラダ') || text.includes('キャベツ') || text.includes('レタス')) return '🥬';
  if (text.includes('玉ねぎ') || text.includes('たまねぎ')) return '🧅';
  if (text.includes('人参') || text.includes('にんじん')) return '🥕';
  if (text.includes('じゃがいも') || text.includes('ポテト')) return '🥔';
  if (text.includes('バナナ')) return '🍌';
  if (text.includes('りんご') || text.includes('リンゴ')) return '🍎';
  if (text.includes('果物') || text.includes('フルーツ') || text.includes('みかん') || text.includes('オレンジ')) return '🍊';
  if (text.includes('米') || text.includes('ごはん')) return '🍚';
  if (text.includes('麺') || text.includes('パスタ') || text.includes('うどん') || text.includes('ラーメン')) return '🍜';
  if (text.includes('ビール') || text.includes('酒') || text.includes('ワイン')) return '🍺';
  if (text.includes('水') || text.includes('お茶') || text.includes('ジュース') || text.includes('コーヒー')) return '☕';
  if (text.includes('チーズ') || text.includes('バター') || text.includes('ヨーグルト')) return '🧀';
  if (text.includes('ペーパー') || text.includes('ティッシュ') || text.includes('洗剤') || text.includes('日用品')) return '🧻';
  if (text.includes('お菓子') || text.includes('チョコ') || text.includes('アイス') || text.includes('スイーツ')) return '🍫';
  if (text.includes('納豆') || text.includes('豆腐')) return '🥢';
  return '🛒';
}

async function getPresetsForUser(userId) {
  const currentPool = getPool();
  await ensureUserInitialized(userId);

  const [rows] = await currentPool.query(
    'SELECT id, name, icon, display_order FROM shopping_presets WHERE user_id = ? ORDER BY display_order ASC, id ASC',
    [userId]
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    icon: row.icon || '🛒'
  }));
}

async function addPreset(userId, name, customIcon = null) {
  const currentPool = getPool();
  await ensureUserInitialized(userId);

  const trimmed = String(name || '').trim();
  if (!trimmed || trimmed.length > 30) {
    return { ok: false, status: 400, message: 'invalid preset name' };
  }

  // 重複チェック
  const [existing] = await currentPool.query(
    'SELECT id FROM shopping_presets WHERE user_id = ? AND LOWER(name) = LOWER(?) LIMIT 1',
    [userId, trimmed]
  );

  if (existing.length > 0) {
    return { ok: false, status: 409, message: 'duplicate preset' };
  }

  const icon = customIcon || detectIcon(trimmed);

  const [orderResult] = await currentPool.query(
    'SELECT COALESCE(MAX(display_order), 0) AS max_order FROM shopping_presets WHERE user_id = ?',
    [userId]
  );
  const nextOrder = (orderResult[0]?.max_order || 0) + 1;

  const [insertResult] = await currentPool.query(
    'INSERT INTO shopping_presets (user_id, name, icon, display_order) VALUES (?, ?, ?, ?)',
    [userId, trimmed, icon, nextOrder]
  );

  return {
    ok: true,
    preset: {
      id: insertResult.insertId,
      name: trimmed,
      icon
    }
  };
}

async function deletePreset(userId, presetId) {
  const currentPool = getPool();
  const id = Number(presetId);
  if (!id) return { ok: false, status: 404, message: 'invalid preset id' };

  const [result] = await currentPool.query(
    'DELETE FROM shopping_presets WHERE user_id = ? AND id = ?',
    [userId, id]
  );

  return {
    ok: true,
    deleted: result.affectedRows > 0,
    id
  };
}

async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

async function getAllDataForAdmin() {
  const currentPool = getPool();
  const [users] = await currentPool.query('SELECT user_id, display_name, created_at FROM shopping_users ORDER BY created_at DESC');
  
  const [items] = await currentPool.query(
    `SELECT i.id, i.user_id, i.name, i.done, i.quantity, u.display_name AS addedByName 
     FROM shopping_items i 
     LEFT JOIN shopping_users u ON i.added_by = u.user_id 
     ORDER BY i.display_order ASC, i.id ASC`
  );
  
  const itemsByUser = {};
  items.forEach(item => {
    if (!itemsByUser[item.user_id]) itemsByUser[item.user_id] = [];
    itemsByUser[item.user_id].push({
      id: item.id,
      name: item.name,
      done: Boolean(item.done),
      quantity: item.quantity || 1,
      addedByName: item.addedByName || ''
    });
  });

  const [notes] = await currentPool.query('SELECT user_id, content FROM shopping_notes');
  const notesByUser = {};
  notes.forEach(n => {
    notesByUser[n.user_id] = n.content;
  });

  return users.map(user => ({
    userId: user.user_id,
    displayName: user.display_name || '',
    isShared: user.user_id.startsWith('room:'),
    createdAt: user.created_at,
    items: itemsByUser[user.user_id] || [],
    note: notesByUser[user.user_id] || ''
  }));
}

async function getUserName(userId) {
  const currentPool = getPool();
  await ensureUserInitialized(userId);
  const [rows] = await currentPool.query('SELECT display_name FROM shopping_users WHERE user_id = ? LIMIT 1', [userId]);
  return rows.length > 0 ? (rows[0].display_name || '') : '';
}

async function updateUserName(userId, name) {
  const currentPool = getPool();
  await ensureUserInitialized(userId);
  const trimmed = String(name || '').trim();
  await currentPool.query('UPDATE shopping_users SET display_name = ? WHERE user_id = ?', [trimmed || null, userId]);
  return { ok: true };
}

module.exports = {
  getPool,
  initDatabase,
  loadItemsForUser,
  addItem,
  toggleItem,
  updateQuantity,
  reorderItems,
  deleteItem,
  deleteCompletedItems,
  getNoteForUser,
  saveNoteForUser,
  getPresetsForUser,
  addPreset,
  deletePreset,
  getAllDataForAdmin,
  getUserName,
  updateUserName,
  closePool
};




