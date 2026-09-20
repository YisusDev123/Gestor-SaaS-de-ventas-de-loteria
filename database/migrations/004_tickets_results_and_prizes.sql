CREATE TABLE IF NOT EXISTS tickets (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_code CHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenant_id BIGINT UNSIGNED NOT NULL,
  draw_id BIGINT UNSIGNED NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'VALID',
  total_amount DECIMAL(15,2) NOT NULL,
  business_date DATE NOT NULL,
  operation_request_id BIGINT UNSIGNED NOT NULL,
  seller_name_snapshot VARCHAR(120) NOT NULL,
  lottery_name_snapshot VARCHAR(100) NOT NULL,
  modality_name_snapshot VARCHAR(100) NOT NULL,
  scheduled_at_snapshot DATETIME(6) NOT NULL,
  created_by_user_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  cancelled_at DATETIME(6) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tickets_public_code (public_code),
  UNIQUE KEY uq_tickets_operation_request (operation_request_id),
  KEY ix_tickets_tenant_date_created (tenant_id, business_date, created_at, id),
  KEY ix_tickets_tenant_draw_status (tenant_id, draw_id, status),
  KEY ix_tickets_tenant_status_created (tenant_id, status, created_at),
  CONSTRAINT fk_tickets_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_tickets_draw FOREIGN KEY (draw_id) REFERENCES draws (id) ON DELETE RESTRICT,
  CONSTRAINT fk_tickets_operation_request FOREIGN KEY (operation_request_id) REFERENCES operation_requests (id) ON DELETE RESTRICT,
  CONSTRAINT fk_tickets_user FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT chk_tickets_status CHECK (status IN ('VALID', 'CANCELLED', 'REPLACED')),
  CONSTRAINT chk_tickets_total CHECK (total_amount > 0),
  CONSTRAINT chk_tickets_public_code CHECK (public_code REGEXP '^[0-9A-HJKMNP-TV-Z]{16}$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS ticket_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id BIGINT UNSIGNED NOT NULL,
  ticket_id BIGINT UNSIGNED NOT NULL,
  draw_id BIGINT UNSIGNED NOT NULL,
  number_value TINYINT UNSIGNED NOT NULL,
  bet_amount DECIMAL(15,2) NOT NULL,
  multiplier_snapshot DECIMAL(12,2) NOT NULL,
  potential_prize_amount DECIMAL(15,2) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_ticket_items_ticket_number (ticket_id, number_value),
  KEY ix_ticket_items_winner_lookup (tenant_id, draw_id, number_value, ticket_id),
  CONSTRAINT fk_ticket_items_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_ticket_items_ticket FOREIGN KEY (ticket_id) REFERENCES tickets (id) ON DELETE RESTRICT,
  CONSTRAINT fk_ticket_items_draw FOREIGN KEY (draw_id) REFERENCES draws (id) ON DELETE RESTRICT,
  CONSTRAINT chk_ticket_items_number CHECK (number_value BETWEEN 0 AND 99),
  CONSTRAINT chk_ticket_items_amount CHECK (bet_amount > 0),
  CONSTRAINT chk_ticket_items_multiplier CHECK (multiplier_snapshot > 0),
  CONSTRAINT chk_ticket_items_prize CHECK (potential_prize_amount >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS ticket_cancellations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id BIGINT UNSIGNED NOT NULL,
  ticket_id BIGINT UNSIGNED NOT NULL,
  operation_request_id BIGINT UNSIGNED NOT NULL,
  reason VARCHAR(500) NOT NULL,
  cancelled_amount DECIMAL(15,2) NOT NULL,
  cancelled_by_user_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_ticket_cancellations_ticket (ticket_id),
  UNIQUE KEY uq_ticket_cancellations_operation_request (operation_request_id),
  KEY ix_ticket_cancellations_tenant_created (tenant_id, created_at),
  CONSTRAINT fk_ticket_cancellations_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_ticket_cancellations_ticket FOREIGN KEY (ticket_id) REFERENCES tickets (id) ON DELETE RESTRICT,
  CONSTRAINT fk_ticket_cancellations_request FOREIGN KEY (operation_request_id) REFERENCES operation_requests (id) ON DELETE RESTRICT,
  CONSTRAINT fk_ticket_cancellations_user FOREIGN KEY (cancelled_by_user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT chk_ticket_cancellations_reason CHECK (CHAR_LENGTH(TRIM(reason)) BETWEEN 1 AND 500),
  CONSTRAINT chk_ticket_cancellations_amount CHECK (cancelled_amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS ticket_replacements (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id BIGINT UNSIGNED NOT NULL,
  original_ticket_id BIGINT UNSIGNED NOT NULL,
  replacement_ticket_id BIGINT UNSIGNED NOT NULL,
  operation_request_id BIGINT UNSIGNED NOT NULL,
  reason VARCHAR(500) NOT NULL,
  created_by_user_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_ticket_replacements_original (original_ticket_id),
  UNIQUE KEY uq_ticket_replacements_replacement (replacement_ticket_id),
  UNIQUE KEY uq_ticket_replacements_request (operation_request_id),
  KEY ix_ticket_replacements_tenant_created (tenant_id, created_at),
  CONSTRAINT fk_ticket_replacements_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_ticket_replacements_original FOREIGN KEY (original_ticket_id) REFERENCES tickets (id) ON DELETE RESTRICT,
  CONSTRAINT fk_ticket_replacements_replacement FOREIGN KEY (replacement_ticket_id) REFERENCES tickets (id) ON DELETE RESTRICT,
  CONSTRAINT fk_ticket_replacements_request FOREIGN KEY (operation_request_id) REFERENCES operation_requests (id) ON DELETE RESTRICT,
  CONSTRAINT fk_ticket_replacements_user FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT chk_ticket_replacements_different CHECK (original_ticket_id <> replacement_ticket_id),
  CONSTRAINT chk_ticket_replacements_reason CHECK (CHAR_LENGTH(TRIM(reason)) BETWEEN 1 AND 500)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS draw_result_versions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id BIGINT UNSIGNED NOT NULL,
  draw_id BIGINT UNSIGNED NOT NULL,
  version_number INT UNSIGNED NOT NULL,
  winning_number TINYINT UNSIGNED NOT NULL,
  previous_version_id BIGINT UNSIGNED NULL,
  change_reason VARCHAR(500) NULL,
  created_by_user_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_draw_result_versions_id_draw (id, draw_id),
  UNIQUE KEY uq_draw_result_versions_draw_version (draw_id, version_number),
  KEY ix_draw_result_versions_tenant_draw (tenant_id, draw_id),
  CONSTRAINT fk_draw_result_versions_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_draw_result_versions_draw FOREIGN KEY (draw_id) REFERENCES draws (id) ON DELETE RESTRICT,
  CONSTRAINT fk_draw_result_versions_previous FOREIGN KEY (previous_version_id) REFERENCES draw_result_versions (id) ON DELETE RESTRICT,
  CONSTRAINT fk_draw_result_versions_user FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT chk_draw_result_versions_number CHECK (winning_number BETWEEN 0 AND 99),
  CONSTRAINT chk_draw_result_versions_version CHECK (version_number >= 1),
  CONSTRAINT chk_draw_result_versions_reason CHECK (
    (version_number = 1 AND previous_version_id IS NULL)
    OR (version_number > 1 AND previous_version_id IS NOT NULL AND CHAR_LENGTH(TRIM(change_reason)) BETWEEN 1 AND 500)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS ticket_prize_evaluations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id BIGINT UNSIGNED NOT NULL,
  draw_id BIGINT UNSIGNED NOT NULL,
  result_version_id BIGINT UNSIGNED NOT NULL,
  ticket_id BIGINT UNSIGNED NOT NULL,
  is_winner BOOLEAN NOT NULL,
  winning_number TINYINT UNSIGNED NOT NULL,
  winning_bet_amount DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  multiplier_snapshot DECIMAL(12,2) NULL,
  prize_amount DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_ticket_prize_evaluations_version_ticket (result_version_id, ticket_id),
  KEY ix_ticket_prize_evaluations_winners (tenant_id, draw_id, result_version_id, is_winner),
  KEY ix_ticket_prize_evaluations_ticket (tenant_id, ticket_id, result_version_id),
  CONSTRAINT fk_ticket_prize_evaluations_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_ticket_prize_evaluations_draw FOREIGN KEY (draw_id) REFERENCES draws (id) ON DELETE RESTRICT,
  CONSTRAINT fk_ticket_prize_evaluations_result FOREIGN KEY (result_version_id) REFERENCES draw_result_versions (id) ON DELETE RESTRICT,
  CONSTRAINT fk_ticket_prize_evaluations_ticket FOREIGN KEY (ticket_id) REFERENCES tickets (id) ON DELETE RESTRICT,
  CONSTRAINT chk_ticket_prize_evaluations_number CHECK (winning_number BETWEEN 0 AND 99),
  CONSTRAINT chk_ticket_prize_evaluations_values CHECK (
    (is_winner = TRUE AND winning_bet_amount > 0 AND multiplier_snapshot > 0 AND prize_amount > 0)
    OR (is_winner = FALSE AND winning_bet_amount = 0 AND multiplier_snapshot IS NULL AND prize_amount = 0)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS prize_payments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id BIGINT UNSIGNED NOT NULL,
  ticket_id BIGINT UNSIGNED NOT NULL,
  result_version_id BIGINT UNSIGNED NOT NULL,
  evaluation_id BIGINT UNSIGNED NOT NULL,
  amount DECIMAL(15,2) NOT NULL,
  operation_request_id BIGINT UNSIGNED NOT NULL,
  paid_by_user_id BIGINT UNSIGNED NOT NULL,
  paid_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_prize_payments_ticket (ticket_id),
  UNIQUE KEY uq_prize_payments_evaluation (evaluation_id),
  UNIQUE KEY uq_prize_payments_request (operation_request_id),
  KEY ix_prize_payments_tenant_paid (tenant_id, paid_at),
  KEY ix_prize_payments_result (result_version_id),
  CONSTRAINT fk_prize_payments_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_prize_payments_ticket FOREIGN KEY (ticket_id) REFERENCES tickets (id) ON DELETE RESTRICT,
  CONSTRAINT fk_prize_payments_result FOREIGN KEY (result_version_id) REFERENCES draw_result_versions (id) ON DELETE RESTRICT,
  CONSTRAINT fk_prize_payments_evaluation FOREIGN KEY (evaluation_id) REFERENCES ticket_prize_evaluations (id) ON DELETE RESTRICT,
  CONSTRAINT fk_prize_payments_request FOREIGN KEY (operation_request_id) REFERENCES operation_requests (id) ON DELETE RESTRICT,
  CONSTRAINT fk_prize_payments_user FOREIGN KEY (paid_by_user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT chk_prize_payments_amount CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

SET @current_result_fk_exists = (
  SELECT COUNT(*)
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'draws'
    AND CONSTRAINT_NAME = 'fk_draws_current_result'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);

SET @current_result_fk_sql = IF(
  @current_result_fk_exists = 0,
  'ALTER TABLE draws ADD CONSTRAINT fk_draws_current_result FOREIGN KEY (current_result_version_id, id) REFERENCES draw_result_versions (id, draw_id) ON DELETE RESTRICT',
  'SELECT 1'
);

PREPARE current_result_fk_statement FROM @current_result_fk_sql;
EXECUTE current_result_fk_statement;
DEALLOCATE PREPARE current_result_fk_statement;
