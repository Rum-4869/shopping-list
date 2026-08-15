const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../app');

test('same user keeps same list and different users get separate lists', async () => {
  const addResA = await request(app)
    .post('/add')
    .set('Cookie', 'shopping_user_id=user-a')
    .set('Accept', 'application/json')
    .set('X-Requested-With', 'XMLHttpRequest')
    .type('form')
    .send({ itemName: '牛乳A' });

  assert.equal(addResA.status, 200);

  const addResB = await request(app)
    .post('/add')
    .set('Cookie', 'shopping_user_id=user-b')
    .set('Accept', 'application/json')
    .set('X-Requested-With', 'XMLHttpRequest')
    .type('form')
    .send({ itemName: '牛乳B' });

  assert.equal(addResB.status, 200);

  const listResA = await request(app)
    .get('/list')
    .set('Cookie', 'shopping_user_id=user-a');

  assert.match(listResA.text, /牛乳A/);
  assert.doesNotMatch(listResA.text, /牛乳B/);

  const listResB = await request(app)
    .get('/list')
    .set('Cookie', 'shopping_user_id=user-b');

  assert.match(listResB.text, /牛乳B/);
  assert.doesNotMatch(listResB.text, /牛乳A/);
});
