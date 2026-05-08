class RateLimiter {
  constructor(windowMs, maxPerWindow) {
    this.windowMs = windowMs;
    this.maxPerWindow = maxPerWindow;
    this.buckets = new Map();
  }

  hit(key) {
    const now = Date.now();
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
}

module.exports = { RateLimiter };
