CREATE TABLE IF NOT EXISTS lotteries (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name VARCHAR(100) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_lotteries_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS lottery_modalities (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  lottery_id BIGINT UNSIGNED NOT NULL,
  code VARCHAR(50) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name VARCHAR(100) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_lottery_modalities_lottery_code (lottery_id, code),
  CONSTRAINT fk_lottery_modalities_lottery FOREIGN KEY (lottery_id) REFERENCES lotteries (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS draw_schedules (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  lottery_modality_id BIGINT UNSIGNED NOT NULL,
  code VARCHAR(60) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  local_time TIME NOT NULL,
  default_close_minutes_before SMALLINT UNSIGNED NOT NULL DEFAULT 10,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_draw_schedules_modality_code (lottery_modality_id, code),
  KEY ix_draw_schedules_active_time (is_active, local_time),
  CONSTRAINT fk_draw_schedules_modality FOREIGN KEY (lottery_modality_id) REFERENCES lottery_modalities (id) ON DELETE RESTRICT,
  CONSTRAINT chk_draw_schedules_close_minutes CHECK (default_close_minutes_before BETWEEN 10 AND 20)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS draw_schedule_weekdays (
  draw_schedule_id BIGINT UNSIGNED NOT NULL,
  iso_weekday TINYINT UNSIGNED NOT NULL,
  PRIMARY KEY (draw_schedule_id, iso_weekday),
  KEY ix_draw_schedule_weekdays_day (iso_weekday, draw_schedule_id),
  CONSTRAINT fk_draw_schedule_weekdays_schedule FOREIGN KEY (draw_schedule_id) REFERENCES draw_schedules (id) ON DELETE RESTRICT,
  CONSTRAINT chk_draw_schedule_weekdays_day CHECK (iso_weekday BETWEEN 1 AND 7)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS tenant_lotteries (
  tenant_id BIGINT UNSIGNED NOT NULL,
  lottery_id BIGINT UNSIGNED NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (tenant_id, lottery_id),
  KEY ix_tenant_lotteries_lottery (lottery_id, is_enabled),
  CONSTRAINT fk_tenant_lotteries_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_tenant_lotteries_lottery FOREIGN KEY (lottery_id) REFERENCES lotteries (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS tenant_modalities (
  tenant_id BIGINT UNSIGNED NOT NULL,
  lottery_modality_id BIGINT UNSIGNED NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  multiplier DECIMAL(12,2) NOT NULL,
  updated_by_user_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (tenant_id, lottery_modality_id),
  KEY ix_tenant_modalities_modality (lottery_modality_id, is_enabled),
  CONSTRAINT fk_tenant_modalities_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_tenant_modalities_modality FOREIGN KEY (lottery_modality_id) REFERENCES lottery_modalities (id) ON DELETE RESTRICT,
  CONSTRAINT fk_tenant_modalities_user FOREIGN KEY (updated_by_user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT chk_tenant_modalities_multiplier CHECK (multiplier > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS tenant_schedules (
  tenant_id BIGINT UNSIGNED NOT NULL,
  draw_schedule_id BIGINT UNSIGNED NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  close_minutes_before SMALLINT UNSIGNED NOT NULL DEFAULT 10,
  updated_by_user_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (tenant_id, draw_schedule_id),
  KEY ix_tenant_schedules_schedule (draw_schedule_id, is_enabled),
  CONSTRAINT fk_tenant_schedules_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_tenant_schedules_schedule FOREIGN KEY (draw_schedule_id) REFERENCES draw_schedules (id) ON DELETE RESTRICT,
  CONSTRAINT fk_tenant_schedules_user FOREIGN KEY (updated_by_user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT chk_tenant_schedules_close_minutes CHECK (close_minutes_before BETWEEN 10 AND 20)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS tenant_limit_settings (
  tenant_id BIGINT UNSIGNED NOT NULL,
  general_number_limit DECIMAL(15,2) NOT NULL,
  updated_by_user_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (tenant_id),
  CONSTRAINT fk_tenant_limit_settings_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_tenant_limit_settings_user FOREIGN KEY (updated_by_user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT chk_tenant_limit_settings_amount CHECK (general_number_limit >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS tenant_daily_lottery_availability (
  tenant_id BIGINT UNSIGNED NOT NULL,
  lottery_id BIGINT UNSIGNED NOT NULL,
  business_date DATE NOT NULL,
  is_enabled_for_sales BOOLEAN NOT NULL,
  changed_by_user_id BIGINT UNSIGNED NOT NULL,
  changed_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  reason VARCHAR(255) NULL,
  PRIMARY KEY (tenant_id, lottery_id, business_date),
  KEY ix_daily_lottery_availability_date (tenant_id, business_date),
  CONSTRAINT fk_daily_lottery_availability_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_daily_lottery_availability_lottery FOREIGN KEY (lottery_id) REFERENCES lotteries (id) ON DELETE RESTRICT,
  CONSTRAINT fk_daily_lottery_availability_user FOREIGN KEY (changed_by_user_id) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
