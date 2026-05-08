const test = require('node:test');
const assert = require('node:assert/strict');

const { issueSessionToken, verifySessionToken } = require('../src/auth');

test('issues and verifies session token', () => {
  const token = issueSessionToken('secret', 60);
  assert.equal(verifySessionToken(token, 'secret'), true);
  assert.equal(verifySessionToken(token, 'wrong'), false);
});
