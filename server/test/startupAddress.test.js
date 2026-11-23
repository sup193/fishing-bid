import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeListenerAddress } from '../src/index.js';

test('listener startup logging handles a null bound address', () => {
  assert.equal(
    describeListenerAddress(null, 5000),
    'configured port 5000 (bound address unavailable)'
  );
});

test('listener startup logging reports the assigned TCP port', () => {
  assert.equal(
    describeListenerAddress({ address: '127.0.0.1', family: 'IPv4', port: 43210 }, 0),
    'http://localhost:43210'
  );
});
