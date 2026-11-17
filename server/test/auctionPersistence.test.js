import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tidemarket-auction-history-'));
const databasePath = path.join(tempDir, 'local-db.json');
process.env.TIDEMARKET_DATABASE = 'local';
process.env.TIDEMARKET_LOCAL_DB_PATH = databasePath;
fs.writeFileSync(databasePath, JSON.stringify({
  auctions: {
    'auction-history': {
      bidHistory: {
        'manual-bid': { id: 'manual-bid', buyer: 'buyer-1', amount: 550, type: 'manual' },
        'automatic-bid': { id: 'automatic-bid', buyer: 'buyer-2', amount: 600, type: 'automatic' }
      }
    }
  },
  bids: {}
}, null, 2));
const database = await import('../src/db.js');

after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

test('canonical auction history remains queryable without a secondary bid mirror', async () => {
  const history = await database.list('bids');
  assert.equal(history.length, 2);
  assert.deepEqual(new Set(history.map(bid => bid.type)), new Set(['manual', 'automatic']));
  assert.equal(history.some(bid => 'maxAmount' in bid || 'automaticMaximum' in bid), false);
});

test('canonical and mirrored bid history deduplicate by bid ID', async () => {
  await database.insert('bids', {
    auction: 'auction-history',
    buyer: 'buyer-1',
    amount: 550,
    type: 'manual'
  }, 'manual-bid');
  const history = await database.list('bids');
  assert.equal(history.length, 2);
  assert.equal(history.filter(bid => bid.id === 'manual-bid').length, 1);
});
