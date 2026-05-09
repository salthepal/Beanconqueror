class RateLimiter {
  constructor(windowMs, maxPerWindow) {
    this.windowMs = windowMs;
    this.maxPerWindow = maxPerWindow;
    this.buckets = new Map();
  }

  async hit(key) {
    const now = Date.now();
    this.pruneExpired(now);
    const existing = this.buckets.get(key);

    if (!existing || now > existing.resetAt) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      return { allowed: true, remaining: this.maxPerWindow - 1 };
    }

    existing.count += 1;
    if (existing.count > this.maxPerWindow) {
      return { allowed: false, remaining: 0 };
    }

    return { allowed: true, remaining: this.maxPerWindow - existing.count };
  }

  pruneExpired(now) {
    for (const [bucketKey, bucket] of this.buckets.entries()) {
      if (now > bucket.resetAt) {
        this.buckets.delete(bucketKey);
      }
    }
  }
}

class DbRateLimiter {
  constructor(windowMs, maxPerWindow, getPool) {
    this.windowMs = windowMs;
    this.maxPerWindow = maxPerWindow;
    this.getPool = getPool;
  }

  async hit(key) {
    const now = Date.now();
    const resetAt = now + this.windowMs;
    const pool = this.getPool();
    await this.pruneExpired(now, pool);

    await pool.query(
      `INSERT INTO api_rate_limits (rate_key, hit_count, reset_at)
       VALUES (?, 1, ?)
       ON DUPLICATE KEY UPDATE
         hit_count = IF(reset_at < ?, 1, hit_count + 1),
         reset_at = IF(reset_at < ?, VALUES(reset_at), reset_at)`,
      [key, resetAt, now, now],
    );

    const [rows] = await pool.query(
      'SELECT hit_count, reset_at FROM api_rate_limits WHERE rate_key = ? LIMIT 1',
      [key],
    );
    const count = Number(rows?.[0]?.hit_count || 0);
    return {
      allowed: count <= this.maxPerWindow,
      remaining: Math.max(0, this.maxPerWindow - count),
    };
  }

  async pruneExpired(now, pool) {
    if (Math.random() > 0.01) {
      return;
    }
    await pool.query(
      'DELETE FROM api_rate_limits WHERE reset_at < ?',
      [now],
    );
  }
}

module.exports = { DbRateLimiter, RateLimiter };
