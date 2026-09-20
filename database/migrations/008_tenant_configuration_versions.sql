CREATE TABLE IF NOT EXISTS tenant_business_settings (
  tenant_id BIGINT UNSIGNED NOT NULL,
  receipt_fields JSON NOT NULL,
  config_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_by_user_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (tenant_id),
  CONSTRAINT fk_tenant_business_settings_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_tenant_business_settings_user FOREIGN KEY (updated_by_user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT chk_tenant_business_settings_version CHECK (config_version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE tenant_lotteries
  ADD COLUMN config_version BIGINT UNSIGNED NOT NULL DEFAULT 1 AFTER is_enabled,
  ADD CONSTRAINT chk_tenant_lotteries_version CHECK (config_version >= 1);

ALTER TABLE tenant_modalities
  ADD COLUMN config_version BIGINT UNSIGNED NOT NULL DEFAULT 1 AFTER multiplier,
  ADD CONSTRAINT chk_tenant_modalities_version CHECK (config_version >= 1);

ALTER TABLE tenant_schedules
  ADD COLUMN config_version BIGINT UNSIGNED NOT NULL DEFAULT 1 AFTER close_minutes_before,
  ADD CONSTRAINT chk_tenant_schedules_version CHECK (config_version >= 1);

ALTER TABLE tenant_limit_settings
  ADD COLUMN config_version BIGINT UNSIGNED NOT NULL DEFAULT 1 AFTER general_number_limit,
  ADD CONSTRAINT chk_tenant_limit_settings_version CHECK (config_version >= 1);

ALTER TABLE tenant_daily_lottery_availability
  ADD COLUMN config_version BIGINT UNSIGNED NOT NULL DEFAULT 1 AFTER is_enabled_for_sales,
  ADD CONSTRAINT chk_tenant_daily_lottery_availability_version CHECK (config_version >= 1);

ALTER TABLE tickets
  ADD COLUMN receipt_fields_snapshot JSON NULL AFTER seller_name_snapshot;
