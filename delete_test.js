require('dotenv').config();
const db = require('./db');

async function main() {
  const pool = db.getPool();
  const queries = [
    "DELETE FROM shopping_users WHERE user_id LIKE 'test-user-%'",
    "DELETE FROM shopping_users WHERE user_id LIKE 'user-a%' OR user_id LIKE 'user-b%'",
    "DELETE FROM shopping_users WHERE user_id LIKE 'user-preset-%'",
    "DELETE FROM shopping_users WHERE user_id LIKE 'user-qty-%'",
    "DELETE FROM shopping_users WHERE user_id LIKE 'room:family-room-%'"
  ];

  for (const q of queries) {
    const [result] = await pool.query(q);
    console.log(`${q} -> Deleted ${result.affectedRows} rows`);
  }

  // Also clean up orphan items/presets/notes for those users via foreign key cascade? 
  // Wait, the schema might not have ON DELETE CASCADE for all tables (e.g., shopping_items, shopping_presets). Let's delete items for non-existing users just to be safe.
  const [itemsResult] = await pool.query(
    "DELETE FROM shopping_items WHERE user_id NOT IN (SELECT user_id FROM shopping_users)"
  );
  console.log(`Deleted ${itemsResult.affectedRows} orphan items`);

  const [presetsResult] = await pool.query(
    "DELETE FROM shopping_presets WHERE user_id NOT IN (SELECT user_id FROM shopping_users)"
  );
  console.log(`Deleted ${presetsResult.affectedRows} orphan presets`);

  db.closePool();
}

main().catch(console.error);
