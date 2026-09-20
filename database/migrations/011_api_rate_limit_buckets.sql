CREATE TABLE IF NOT EXISTS api_rate_limit_buckets (
  bucket_key VARCHAR(255) NOT NULL,
  window_started_at DATETIME(6) NOT NULL,
  hit_count INT UNSIGNED NOT NULL,
  PRIMARY KEY (bucket_key),
  INDEX ix_api_rate_limit_window (window_started_at)
) ENGINE=InnoDB;
