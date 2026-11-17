import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('Firebase Realtime Database client reads and writes are denied by default', () => {
  const rules = JSON.parse(fs.readFileSync(path.join(projectRoot, 'database.rules.json'), 'utf8'));
  assert.equal(rules.rules['.read'], false);
  assert.equal(rules.rules['.write'], false);
});
