const buckets = new Map<string, number[]>();

export function checkAssistantRateLimit(key: string, options: { limit?: number; windowMs?: number } = {}) {
  const limit = options.limit ?? 30;
  const windowMs = options.windowMs ?? 60_000;
  const now = Date.now();
  const cutoff = now - windowMs;
  const current = (buckets.get(key) || []).filter((timestamp) => timestamp > cutoff);

  if (current.length >= limit) {
    return {
      allowed: false,
      retryAfterMs: current[0] + windowMs - now,
      remaining: 0,
    };
  }

  current.push(now);
  buckets.set(key, current);

  return {
    allowed: true,
    retryAfterMs: 0,
    remaining: Math.max(0, limit - current.length),
  };
}

export function resetAssistantRateLimitForTests() {
  buckets.clear();
}
