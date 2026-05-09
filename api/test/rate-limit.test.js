const test = require('node:test');
const assert = require('node:assert/strict');

const { RateLimiter } = require('../src/rate-limit');

test('limits requests inside window', async () => {
  const limiter = new RateLimiter(1000, 2);
  assert.equal((await limiter.hit('a')).allowed, true);
  assert.equal((await limiter.hit('a')).allowed, true);
  assert.equal((await limiter.hit('a')).allowed, false);
});
