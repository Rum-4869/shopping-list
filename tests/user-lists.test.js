const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../app');
const db = require('../db');

test.before(async () => {
  await db.initDatabase();
});

test.after(async () => {
  await db.closePool();
});

test('same user keeps same list and different users get separate lists', async () => {
  const testUserA = `test-user-a-${Date.now()}`;
  const testUserB = `test-user-b-${Date.now()}`;

  const addResA = await request(app)
    .post('/add')
    .set('Cookie', `shopping_user_id=${testUserA}`)
    .set('Accept', 'application/json')
    .set('X-Requested-With', 'XMLHttpRequest')
    .type('form')
    .send({ itemName: '特製牛乳A' });

  assert.equal(addResA.status, 200);
  assert.equal(addResA.body.ok, true);

  const addResB = await request(app)
    .post('/add')
    .set('Cookie', `shopping_user_id=${testUserB}`)
    .set('Accept', 'application/json')
    .set('X-Requested-With', 'XMLHttpRequest')
    .type('form')
    .send({ itemName: '特製牛乳B' });

  assert.equal(addResB.status, 200);
  assert.equal(addResB.body.ok, true);

  const listResA = await request(app)
    .get('/list')
    .set('Cookie', `shopping_user_id=${testUserA}`);

  assert.match(listResA.text, /特製牛乳A/);
  assert.doesNotMatch(listResA.text, /特製牛乳B/);

  const listResB = await request(app)
    .get('/list')
    .set('Cookie', `shopping_user_id=${testUserB}`);

  assert.match(listResB.text, /特製牛乳B/);
  assert.doesNotMatch(listResB.text, /特製牛乳A/);
});

test('CRUD operations (add, toggle, reorder, delete) persist properly in TiDB', async () => {
  const testUser = `test-user-crud-${Date.now()}`;

  // 1. 初期アイテム取得（4件）
  const initialItems = await db.loadItemsForUser(testUser);
  assert.equal(initialItems.length, 4);

  // 2. アイテム追加
  const addRes = await request(app)
    .post('/add')
    .set('Cookie', `shopping_user_id=${testUser}`)
    .set('Accept', 'application/json')
    .set('X-Requested-With', 'XMLHttpRequest')
    .type('form')
    .send({ itemName: 'リンゴ' });

  assert.equal(addRes.status, 200);
  assert.equal(addRes.body.ok, true);
  const newItemId = addRes.body.item.id;

  // 3. トグル（未完了 -> 完了）
  const toggleRes = await request(app)
    .post(`/toggle/${newItemId}`)
    .set('Cookie', `shopping_user_id=${testUser}`)
    .set('Accept', 'application/json')
    .set('X-Requested-With', 'XMLHttpRequest');

  assert.equal(toggleRes.status, 200);
  assert.equal(toggleRes.body.ok, true);
  assert.equal(toggleRes.body.item.done, true);

  // 4. 削除
  const deleteRes = await request(app)
    .post(`/delete/${newItemId}`)
    .set('Cookie', `shopping_user_id=${testUser}`)
    .set('Accept', 'application/json')
    .set('X-Requested-With', 'XMLHttpRequest');

  assert.equal(deleteRes.status, 200);
  assert.equal(deleteRes.body.ok, true);
  assert.equal(deleteRes.body.deleted, true);

  // 5. 削除確認
  const finalItems = await db.loadItemsForUser(testUser);
  const exists = finalItems.some((i) => i.id === newItemId);
  assert.equal(exists, false);
});

test('clear-completed removes only done items and keeps active items', async () => {
  const testUser = `test-user-clear-${Date.now()}`;

  // 初期アイテム（4件）取得
  const items = await db.loadItemsForUser(testUser);
  assert.equal(items.length, 4);

  // 1つ目と2つ目をトグルして完了にする
  await request(app)
    .post(`/toggle/${items[0].id}`)
    .set('Cookie', `shopping_user_id=${testUser}`)
    .set('Accept', 'application/json')
    .set('X-Requested-With', 'XMLHttpRequest');

  await request(app)
    .post(`/toggle/${items[1].id}`)
    .set('Cookie', `shopping_user_id=${testUser}`)
    .set('Accept', 'application/json')
    .set('X-Requested-With', 'XMLHttpRequest');

  // 一括削除実行
  const clearRes = await request(app)
    .post('/clear-completed')
    .set('Cookie', `shopping_user_id=${testUser}`)
    .set('Accept', 'application/json')
    .set('X-Requested-With', 'XMLHttpRequest');

  assert.equal(clearRes.status, 200);
  assert.equal(clearRes.body.ok, true);
  assert.equal(clearRes.body.count, 2);

  // 残りアイテムを確認（未完了の2件のみ残っていること）
  const remaining = await db.loadItemsForUser(testUser);
  assert.equal(remaining.length, 2);
  assert.equal(remaining.every((item) => !item.done), true);
});

test('Notes are persisted to TiDB and separate per user', async () => {
  const userA = `test-user-note-a-${Date.now()}`;
  const userB = `test-user-note-b-${Date.now()}`;

  // ユーザーAがメモ保存
  const saveRes = await request(app)
    .post('/notes')
    .set('Cookie', `shopping_user_id=${userA}`)
    .set('Accept', 'application/json')
    .set('X-Requested-With', 'XMLHttpRequest')
    .type('form')
    .send({ content: 'カレーの材料：じゃがいも、人参' });

  assert.equal(saveRes.status, 200);
  assert.equal(saveRes.body.ok, true);

  // ユーザーAがメモ取得
  const getResA = await request(app)
    .get('/notes')
    .set('Cookie', `shopping_user_id=${userA}`);

  assert.match(getResA.text, /カレーの材料：じゃがいも、人参/);

  // ユーザーBにはユーザーAのメモが見えないこと
  const getResB = await request(app)
    .get('/notes')
    .set('Cookie', `shopping_user_id=${userB}`);

  assert.doesNotMatch(getResB.text, /カレーの材料：じゃがいも、人参/);
});

test('Room code sharing allows multiple users to share same list and note', async () => {
  const roomName = `family-room-${Date.now()}`;
  const userA = `user-a-${Date.now()}`;
  const userB = `user-b-${Date.now()}`;

  // ユーザーAが合言葉に参加
  const joinResA = await request(app)
    .post('/share/join')
    .set('Cookie', `shopping_user_id=${userA}`)
    .set('Accept', 'application/json')
    .type('form')
    .send({ roomName });

  assert.equal(joinResA.status, 200);

  // ユーザーAが共有リストにアイテム追加
  const addRes = await request(app)
    .post('/add')
    .set('Cookie', `shopping_user_id=${userA}; shopping_room_id=${roomName}`)
    .set('Accept', 'application/json')
    .set('X-Requested-With', 'XMLHttpRequest')
    .type('form')
    .send({ itemName: 'みんなのアイス' });

  assert.equal(addRes.status, 200);
  assert.equal(addRes.body.ok, true);

  // ユーザーBが同じ合言葉で参加してリストを閲覧
  const listResB = await request(app)
    .get('/list')
    .set('Cookie', `shopping_user_id=${userB}; shopping_room_id=${roomName}`);

  assert.match(listResB.text, /みんなのアイス/);
  assert.match(listResB.text, new RegExp(roomName));
  assert.match(listResB.text, /共有中/);
});

test('Presets (common items) can be loaded, added, and deleted per user', async () => {
  const testUser = `user-preset-${Date.now()}`;

  // 1. 初期プリセット取得（7件）
  const initialPresets = await db.getPresetsForUser(testUser);
  assert.equal(initialPresets.length, 7);

  // 2. プリセット新規追加（納豆）
  const addRes = await request(app)
    .post('/presets/add')
    .set('Cookie', `shopping_user_id=${testUser}`)
    .set('Accept', 'application/json')
    .type('form')
    .send({ name: '納豆' });

  assert.equal(addRes.status, 200);
  assert.equal(addRes.body.ok, true);
  assert.equal(addRes.body.preset.name, '納豆');
  assert.equal(addRes.body.preset.icon, '🥢');
  const newPresetId = addRes.body.preset.id;

  // 3. リスト画面に納豆プリセットが表示されていること
  const listRes = await request(app)
    .get('/list')
    .set('Cookie', `shopping_user_id=${testUser}`);

  assert.match(listRes.text, /納豆/);

  // 4. プリセット削除
  const delRes = await request(app)
    .post(`/presets/delete/${newPresetId}`)
    .set('Cookie', `shopping_user_id=${testUser}`)
    .set('Accept', 'application/json');

  assert.equal(delRes.status, 200);
  assert.equal(delRes.body.ok, true);

  // 5. 削除確認
  const afterPresets = await db.getPresetsForUser(testUser);
  const exists = afterPresets.some((p) => p.id === newPresetId);
  assert.equal(exists, false);
});

test('Quantity updates correctly and respects minimum of 1', async () => {
  const testUser = `user-qty-${Date.now()}`;

  // 1. アイテム追加
  const addRes = await request(app)
    .post('/add')
    .set('Cookie', `shopping_user_id=${testUser}`)
    .set('Accept', 'application/json')
    .type('form')
    .send({ itemName: 'みかん' });

  assert.equal(addRes.status, 200);
  const itemId = addRes.body.item.id;
  assert.equal(addRes.body.item.quantity, 1);

  // 2. 数量を+1
  const plusRes = await request(app)
    .post(`/update-quantity/${itemId}`)
    .set('Cookie', `shopping_user_id=${testUser}`)
    .set('Accept', 'application/json')
    .type('form')
    .send({ delta: 1 });

  assert.equal(plusRes.status, 200);
  assert.equal(plusRes.body.item.quantity, 2);

  // 3. 数量を-1
  const minusRes = await request(app)
    .post(`/update-quantity/${itemId}`)
    .set('Cookie', `shopping_user_id=${testUser}`)
    .set('Accept', 'application/json')
    .type('form')
    .send({ delta: -1 });

  assert.equal(minusRes.status, 200);
  assert.equal(minusRes.body.item.quantity, 1);

  // 4. さらに数量を-1（1未満にならないこと）
  const minusAgainRes = await request(app)
    .post(`/update-quantity/${itemId}`)
    .set('Cookie', `shopping_user_id=${testUser}`)
    .set('Accept', 'application/json')
    .type('form')
    .send({ delta: -1 });

  assert.equal(minusAgainRes.status, 200);
  assert.equal(minusAgainRes.body.item.quantity, 1);
});
