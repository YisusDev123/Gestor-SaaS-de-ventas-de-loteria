CREATE TABLE IF NOT EXISTS tenant_daily_summaries (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id BIGINT UNSIGNED NOT NULL,
  business_date DATE NOT NULL,
  opening_balance DECIMAL(15,2) NOT NULL,
  gross_sales_amount DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  cancelled_sales_amount DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  net_sales_amount DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  generated_prizes_amount DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  paid_prizes_amount DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  manual_credits_amount DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  manual_debits_amount DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  closing_balance DECIMAL(15,2) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'OPEN',
  calculated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  closed_at DATETIME(6) NULL,
  calculation_version INT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tenant_daily_summaries_tenant_date (tenant_id, business_date),
  KEY ix_tenant_daily_summaries_date (business_date, tenant_id),
  CONSTRAINT fk_tenant_daily_summaries_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
  CONSTRAINT chk_tenant_daily_summaries_status CHECK (status IN ('OPEN', 'CLOSED', 'RECALCULATED')),
  CONSTRAINT chk_tenant_daily_summaries_amounts CHECK (
    gross_sales_amount >= 0
    AND cancelled_sales_amount >= 0
    AND net_sales_amount >= 0
    AND generated_prizes_amount >= 0
    AND paid_prizes_amount >= 0
    AND manual_credits_amount >= 0
    AND manual_debits_amount >= 0
  ),
  CONSTRAINT chk_tenant_daily_summaries_version CHECK (calculation_version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS audit_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id BIGINT UNSIGNED NULL,
  actor_scope VARCHAR(16) NOT NULL,
  actor_id BIGINT UNSIGNED NULL,
  event_type VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  entity_type VARCHAR(60) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  entity_id BIGINT UNSIGNED NULL,
  correlation_id VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NULL,
  reason VARCHAR(500) NULL,
  metadata JSON NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY ix_audit_events_tenant_created (tenant_id, created_at, id),
  KEY ix_audit_events_entity (entity_type, entity_id),
  KEY ix_audit_events_type_created (event_type, created_at),
  CONSTRAINT fk_audit_events_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
  CONSTRAINT chk_audit_events_actor_scope CHECK (actor_scope IN ('USER', 'ADMIN', 'JOB', 'SYSTEM')),
  CONSTRAINT chk_audit_events_actor CHECK (
    (actor_scope = 'SYSTEM' AND actor_id IS NULL)
    OR (actor_scope <> 'SYSTEM' AND actor_id IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS job_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  job_name VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  run_key VARCHAR(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'RUNNING',
  started_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  finished_at DATETIME(6) NULL,
  summary JSON NULL,
  error_code VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_job_runs_run_key (run_key),
  KEY ix_job_runs_name_started (job_name, started_at),
  KEY ix_job_runs_status_started (status, started_at),
  CONSTRAINT chk_job_runs_status CHECK (status IN ('RUNNING', 'COMPLETED', 'FAILED', 'PARTIAL'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS job_run_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  job_run_id BIGINT UNSIGNED NOT NULL,
  tenant_id BIGINT UNSIGNED NULL,
  item_key VARCHAR(180) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  attempt_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  error_code VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NULL,
  processed_at DATETIME(6) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_job_run_items_run_item (job_run_id, item_key),
  KEY ix_job_run_items_status (job_run_id, status, id),
  KEY ix_job_run_items_tenant (tenant_id, processed_at),
  CONSTRAINT fk_job_run_items_run FOREIGN KEY (job_run_id) REFERENCES job_runs (id) ON DELETE RESTRICT,
  CONSTRAINT fk_job_run_items_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
  CONSTRAINT chk_job_run_items_status CHECK (status IN ('PENDING', 'COMPLETED', 'FAILED', 'SKIPPED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
