const test = require('node:test');
const assert = require('node:assert/strict');

const { DbRateLimiter, RateLimiter } = require('../src/rate-limit');

test('limits requests inside window', async () => {
  const limiter = new RateLimiter(1000, 2);
  assert.equal((await limiter.hit('a')).allowed, true);
  assert.equal((await limiter.hit('a')).allowed, true);
  assert.equal((await limiter.hit('a')).allowed, false);
});

test('db limiter enforces max and prunes expired rows', async () => {
  const calls = [];
  let count = 0;
  const pool = {
    query: async (sql) => {
      calls.push(sql);
      if (sql.startsWith('SELECT hit_count')) {
        count += 1;
        return [[{ hit_count: count, reset_at: Date.now() + 1000 }]];
      }
      return [[]];
    },
  };

  const random = Math.random;
  Math.random = () => 0;
  try {
    const limiter = new DbRateLimiter(1000, 2, () => pool);
    assert.equal((await limiter.hit('db')).allowed, true);
    assert.equal((await limiter.hit('db')).allowed, true);
    assert.equal((await limiter.hit('db')).allowed, false);
  } finally {
    Math.random = random;
  }

  assert.equal(calls.some((sql) => sql.includes('DELETE FROM api_rate_limits')), true);
});
