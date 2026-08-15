require('dotenv').config();
const mysql = require('mysql2/promise');

let pool = null;

function getPool() {
  if (!pool) {
    const sslConfig =
      process.env.TIDB_ENABLE_SSL === 'true' || process.env.TIDB_ENABLE_SSL === true
        ? { minVersion: 'TLSv1.2', rejectUnauthorized: true }
        : undefined;

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
  return pool;
}

const DEFAULT_ITEMS = ['牛乳', '卵', '食パン', 'お肉'];

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
      display_order INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
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
  }
}

async function loadItemsForUser(userId) {
  const currentPool = getPool();
  await ensureUserInitialized(userId);

  const [rows] = await currentPool.query(
    'SELECT id, name, done, display_order FROM shopping_items WHERE user_id = ? ORDER BY display_order ASC, id ASC',
    [userId]
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    done: Boolean(row.done)
  }));
}

async function addItem(userId, name) {
  const currentPool = getPool();
  await ensureUserInitialized(userId);

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
    'INSERT INTO shopping_items (user_id, name, done, display_order) VALUES (?, ?, 0, ?)',
    [userId, trimmedName, nextOrder]
  );

  const newItem = {
    id: insertResult.insertId,
    name: trimmedName,
    done: false
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
      done: Boolean(newDone)
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

async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = {
  getPool,
  initDatabase,
  loadItemsForUser,
  addItem,
  toggleItem,
  reorderItems,
  deleteItem,
  closePool
};

