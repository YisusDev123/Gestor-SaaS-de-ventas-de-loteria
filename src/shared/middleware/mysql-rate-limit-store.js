export function createMySqlRateLimitStore(pool, prefix, windowMs) {
  return {
    async init() {},

    async increment(key) {
      const bucketKey = `${prefix}:${key}`;
      const boundary = new Date(Date.now() - windowMs);
      await pool.execute(
        `INSERT INTO api_rate_limit_buckets (bucket_key, window_started_at, hit_count)
         VALUES (?, UTC_TIMESTAMP(6), 1)
         ON DUPLICATE KEY UPDATE
           hit_count = IF(window_started_at <= ?, 1, hit_count + 1),
           window_started_at = IF(window_started_at <= ?, UTC_TIMESTAMP(6), window_started_at)`,
        [bucketKey, boundary, boundary],
      );
      const [rows] = await pool.execute(
        'SELECT window_started_at AS windowStartedAt, hit_count AS totalHits FROM api_rate_limit_buckets WHERE bucket_key = ? LIMIT 1',
        [bucketKey],
      );
      const row = rows[0];
      return {
        totalHits: Number(row?.totalHits || 0),
        resetTime: new Date(new Date(row?.windowStartedAt || Date.now()).getTime() + windowMs),
      };
    },

    async decrement(key) {
      await pool.execute(
        'UPDATE api_rate_limit_buckets SET hit_count = GREATEST(hit_count - 1, 0) WHERE bucket_key = ?',
        [`${prefix}:${key}`],
      );
    },

    async resetKey(key) {
      await pool.execute('DELETE FROM api_rate_limit_buckets WHERE bucket_key = ?', [`${prefix}:${key}`]);
    },

    async resetAll() {
      await pool.execute('DELETE FROM api_rate_limit_buckets WHERE bucket_key LIKE ?', [`${prefix}:%`]);
    },
  };
}
