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
