CREATE TABLE IF NOT EXISTS tenants (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  display_name VARCHAR(120) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
  timezone VARCHAR(64) NOT NULL DEFAULT 'America/Costa_Rica',
  currency_code CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'CRC',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_tenants_public_id (public_id),
  KEY ix_tenants_status (status),
  CONSTRAINT chk_tenants_status CHECK (status IN ('ACTIVE', 'SUSPENDED', 'CLOSED')),
  CONSTRAINT chk_tenants_display_name CHECK (CHAR_LENGTH(TRIM(display_name)) BETWEEN 1 AND 120),
  CONSTRAINT chk_tenants_currency CHECK (currency_code = 'CRC')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  email_normalized VARCHAR(254) NOT NULL,
  password_hash VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
  password_changed_at DATETIME(6) NULL,
  last_login_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_public_id (public_id),
  UNIQUE KEY uq_users_email_normalized (email_normalized),
  KEY ix_users_status (status),
  CONSTRAINT chk_users_status CHECK (status IN ('ACTIVE', 'DISABLED', 'LOCKED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS saas_admins (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email_normalized VARCHAR(254) NOT NULL,
  password_hash VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
  password_changed_at DATETIME(6) NULL,
  last_login_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_saas_admins_email_normalized (email_normalized),
  KEY ix_saas_admins_status (status),
  CONSTRAINT chk_saas_admins_status CHECK (status IN ('ACTIVE', 'DISABLED', 'LOCKED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS tenant_memberships (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  role VARCHAR(24) NOT NULL DEFAULT 'OWNER',
  status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_tenant_memberships_tenant_user (tenant_id, user_id),
  KEY ix_tenant_memberships_user_status (user_id, status),
  CONSTRAINT fk_tenant_memberships_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_tenant_memberships_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT chk_tenant_memberships_role CHECK (role IN ('OWNER', 'MANAGER', 'SELLER', 'VIEWER')),
  CONSTRAINT chk_tenant_memberships_status CHECK (status IN ('ACTIVE', 'DISABLED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS user_sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  refresh_token_hash BINARY(32) NOT NULL,
  family_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  expires_at DATETIME(6) NOT NULL,
  revoked_at DATETIME(6) NULL,
  replaced_by_session_id BIGINT UNSIGNED NULL,
  created_ip_hash BINARY(32) NULL,
  user_agent_summary VARCHAR(255) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_user_sessions_token_hash (refresh_token_hash),
  KEY ix_user_sessions_user_expiry (user_id, expires_at),
  KEY ix_user_sessions_family (family_id),
  KEY ix_user_sessions_expiry (expires_at),
  CONSTRAINT fk_user_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_user_sessions_replacement FOREIGN KEY (replaced_by_session_id) REFERENCES user_sessions (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS admin_sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  admin_id BIGINT UNSIGNED NOT NULL,
  refresh_token_hash BINARY(32) NOT NULL,
  family_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  expires_at DATETIME(6) NOT NULL,
  revoked_at DATETIME(6) NULL,
  replaced_by_session_id BIGINT UNSIGNED NULL,
  created_ip_hash BINARY(32) NULL,
  user_agent_summary VARCHAR(255) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_admin_sessions_token_hash (refresh_token_hash),
  KEY ix_admin_sessions_admin_expiry (admin_id, expires_at),
  KEY ix_admin_sessions_family (family_id),
  KEY ix_admin_sessions_expiry (expires_at),
  CONSTRAINT fk_admin_sessions_admin FOREIGN KEY (admin_id) REFERENCES saas_admins (id) ON DELETE RESTRICT,
  CONSTRAINT fk_admin_sessions_replacement FOREIGN KEY (replaced_by_session_id) REFERENCES admin_sessions (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_scope VARCHAR(16) NOT NULL,
  actor_id BIGINT UNSIGNED NOT NULL,
  token_hash BINARY(32) NOT NULL,
  purpose VARCHAR(40) NOT NULL DEFAULT 'PASSWORD_RESET',
  expires_at DATETIME(6) NOT NULL,
  consumed_at DATETIME(6) NULL,
  attempt_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_password_reset_tokens_hash (token_hash),
  KEY ix_password_reset_actor (actor_scope, actor_id, expires_at),
  KEY ix_password_reset_expiry (expires_at),
  CONSTRAINT chk_password_reset_scope CHECK (actor_scope IN ('USER', 'ADMIN'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS subscription_plans (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name VARCHAR(80) NOT NULL,
  current_price DECIMAL(15,2) NOT NULL DEFAULT 5000.00,
  currency_code CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'CRC',
  trial_days SMALLINT UNSIGNED NOT NULL DEFAULT 3,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_subscription_plans_code (code),
  CONSTRAINT chk_subscription_plans_price CHECK (current_price >= 0),
  CONSTRAINT chk_subscription_plans_trial CHECK (trial_days <= 365),
  CONSTRAINT chk_subscription_plans_currency CHECK (currency_code = 'CRC')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS subscriptions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id BIGINT UNSIGNED NOT NULL,
  plan_id BIGINT UNSIGNED NOT NULL,
  status VARCHAR(24) NOT NULL,
  trial_started_at DATETIME(6) NULL,
  trial_ends_at DATETIME(6) NULL,
  access_ends_at DATETIME(6) NOT NULL,
  suspension_reason_public VARCHAR(255) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_subscriptions_tenant (tenant_id),
  KEY ix_subscriptions_status_access_end (status, access_ends_at),
  KEY ix_subscriptions_plan (plan_id),
  CONSTRAINT fk_subscriptions_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_subscriptions_plan FOREIGN KEY (plan_id) REFERENCES subscription_plans (id) ON DELETE RESTRICT,
  CONSTRAINT chk_subscriptions_status CHECK (status IN ('TRIAL', 'ACTIVE', 'EXPIRED', 'SUSPENDED', 'CLOSED')),
  CONSTRAINT chk_subscriptions_trial_dates CHECK (
    (trial_started_at IS NULL AND trial_ends_at IS NULL)
    OR (trial_started_at IS NOT NULL AND trial_ends_at IS NOT NULL AND trial_ends_at > trial_started_at)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS subscription_periods (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  subscription_id BIGINT UNSIGNED NOT NULL,
  period_type VARCHAR(16) NOT NULL,
  starts_at DATETIME(6) NOT NULL,
  ends_at DATETIME(6) NOT NULL,
  agreed_price DECIMAL(15,2) NOT NULL,
  currency_code CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'CRC',
  status VARCHAR(24) NOT NULL,
  created_by_admin_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY ix_subscription_periods_range (subscription_id, starts_at, ends_at),
  CONSTRAINT fk_subscription_periods_subscription FOREIGN KEY (subscription_id) REFERENCES subscriptions (id) ON DELETE RESTRICT,
  CONSTRAINT fk_subscription_periods_admin FOREIGN KEY (created_by_admin_id) REFERENCES saas_admins (id) ON DELETE RESTRICT,
  CONSTRAINT chk_subscription_periods_type CHECK (period_type IN ('TRIAL', 'PAID', 'GRACE')),
  CONSTRAINT chk_subscription_periods_status CHECK (status IN ('PENDING', 'CONFIRMED', 'VOID')),
  CONSTRAINT chk_subscription_periods_dates CHECK (ends_at > starts_at),
  CONSTRAINT chk_subscription_periods_price CHECK (agreed_price >= 0),
  CONSTRAINT chk_subscription_periods_currency CHECK (currency_code = 'CRC')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS subscription_payments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  subscription_period_id BIGINT UNSIGNED NOT NULL,
  amount DECIMAL(15,2) NOT NULL,
  currency_code CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'CRC',
  paid_at DATETIME(6) NOT NULL,
  confirmed_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  confirmed_by_admin_id BIGINT UNSIGNED NOT NULL,
  note VARCHAR(500) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_subscription_payments_period (subscription_period_id),
  KEY ix_subscription_payments_paid_at (paid_at),
  CONSTRAINT fk_subscription_payments_period FOREIGN KEY (subscription_period_id) REFERENCES subscription_periods (id) ON DELETE RESTRICT,
  CONSTRAINT fk_subscription_payments_admin FOREIGN KEY (confirmed_by_admin_id) REFERENCES saas_admins (id) ON DELETE RESTRICT,
  CONSTRAINT chk_subscription_payments_amount CHECK (amount >= 0),
  CONSTRAINT chk_subscription_payments_currency CHECK (currency_code = 'CRC')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
