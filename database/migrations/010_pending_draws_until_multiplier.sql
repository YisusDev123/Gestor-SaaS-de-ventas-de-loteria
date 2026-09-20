ALTER TABLE tenant_modalities
  MODIFY COLUMN multiplier DECIMAL(12,2) NULL;

ALTER TABLE draws
  DROP CHECK chk_draws_multiplier,
  MODIFY COLUMN multiplier_snapshot DECIMAL(12,2) NULL,
  ADD CONSTRAINT chk_draws_multiplier CHECK (
    (status = 'PENDING' AND multiplier_snapshot IS NULL)
    OR (status <> 'PENDING' AND multiplier_snapshot > 0)
  );

INSERT IGNORE INTO tenant_lotteries (tenant_id, lottery_id, is_enabled)
SELECT t.id, l.id, TRUE
FROM tenants t
JOIN lotteries l ON l.is_active = TRUE
WHERE t.status = 'ACTIVE';

INSERT IGNORE INTO tenant_modalities
  (tenant_id, lottery_modality_id, is_enabled, multiplier, updated_by_user_id)
SELECT owner.tenant_id, lm.id, TRUE, NULL, owner.user_id
FROM (
  SELECT tm.tenant_id, MIN(tm.user_id) AS user_id
  FROM tenant_memberships tm
  WHERE tm.role = 'OWNER' AND tm.status = 'ACTIVE'
  GROUP BY tm.tenant_id
) owner
JOIN tenants t ON t.id = owner.tenant_id AND t.status = 'ACTIVE'
JOIN lotteries l ON l.is_active = TRUE
JOIN lottery_modalities lm ON lm.lottery_id = l.id AND lm.is_active = TRUE;

INSERT IGNORE INTO tenant_schedules
  (tenant_id, draw_schedule_id, is_enabled, close_minutes_before, updated_by_user_id)
SELECT owner.tenant_id, ds.id, TRUE, ds.default_close_minutes_before, owner.user_id
FROM (
  SELECT tm.tenant_id, MIN(tm.user_id) AS user_id
  FROM tenant_memberships tm
  WHERE tm.role = 'OWNER' AND tm.status = 'ACTIVE'
  GROUP BY tm.tenant_id
) owner
JOIN tenants t ON t.id = owner.tenant_id AND t.status = 'ACTIVE'
JOIN lotteries l ON l.is_active = TRUE
JOIN lottery_modalities lm ON lm.lottery_id = l.id AND lm.is_active = TRUE
JOIN draw_schedules ds ON ds.lottery_modality_id = lm.id AND ds.is_active = TRUE;

INSERT IGNORE INTO tenant_limit_settings
  (tenant_id, general_number_limit, updated_by_user_id)
SELECT owner.tenant_id, '10000.00', owner.user_id
FROM (
  SELECT tm.tenant_id, MIN(tm.user_id) AS user_id
  FROM tenant_memberships tm
  WHERE tm.role = 'OWNER' AND tm.status = 'ACTIVE'
  GROUP BY tm.tenant_id
) owner
JOIN tenants t ON t.id = owner.tenant_id AND t.status = 'ACTIVE';
