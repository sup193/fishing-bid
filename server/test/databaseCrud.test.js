import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tidemarket-database-crud-'));
process.env.TIDEMARKET_DATABASE = 'local';
process.env.TIDEMARKET_LOCAL_DB_PATH = path.join(tempDir, 'local-db.json');
const database = await import('../src/db.js');

after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

test('database helpers preserve CRUD shape and idempotent explicit inserts', async () => {
  const inserted = await database.insert('users', { name: 'Test Buyer', role: 'buyer' }, 'crud-buyer');
  assert.equal(inserted.id, 'crud-buyer');
  assert.equal((await database.get('users', inserted.id)).name, 'Test Buyer');

  const duplicate = await database.insert('users', { name: 'Must not overwrite', role: 'admin' }, 'crud-buyer');
  assert.equal(duplicate.name, 'Test Buyer');

  const updated = await database.update('users', inserted.id, { location: 'Harbor' });
  assert.equal(updated.location, 'Harbor');
  assert.equal((await database.list('users')).length, 1);

  const mutation = await database.transact('users', inserted.id, current => ({
    ...current,
    role: 'fisherman'
  }));
  assert.equal(mutation.committed, true);
  assert.equal(mutation.value.role, 'fisherman');

  await database.remove('users', inserted.id);
  assert.equal(await database.get('users', inserted.id), null);
});

test('listing reservation permits only one buyer and collection clearing is scoped', async () => {
  await database.insert('listings', { status: 'available', quantity: 10 }, 'crud-listing');
  assert.equal(await database.reserveListing('crud-listing', 'buyer-one'), true);
  assert.equal(await database.reserveListing('crud-listing', 'buyer-two'), false);
  assert.equal((await database.get('listings', 'crud-listing')).reservedBy, 'buyer-one');

  await database.clearCollections(['listings']);
  assert.equal(await database.get('listings', 'crud-listing'), null);
});
