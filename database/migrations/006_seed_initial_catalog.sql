INSERT INTO subscription_plans (
  code,
  name,
  current_price,
  currency_code,
  trial_days,
  is_active
) VALUES (
  'MONTHLY_BASE',
  'Plan mensual',
  5000.00,
  'CRC',
  3,
  TRUE
) ON DUPLICATE KEY UPDATE code = VALUES(code);

INSERT INTO lotteries (code, name, is_active, sort_order) VALUES
  ('NICA', 'Nica', TRUE, 10),
  ('TICA', 'Tica', TRUE, 20),
  ('PRIMERA', 'Primera', TRUE, 30)
ON DUPLICATE KEY UPDATE code = VALUES(code);

INSERT INTO lottery_modalities (lottery_id, code, name, is_active, sort_order)
SELECT id, 'NORMAL', 'Normal', TRUE, 10 FROM lotteries WHERE code = 'NICA'
ON DUPLICATE KEY UPDATE code = VALUES(code);

INSERT INTO lottery_modalities (lottery_id, code, name, is_active, sort_order)
SELECT id, 'NORMAL', 'Normal', TRUE, 10 FROM lotteries WHERE code = 'TICA'
ON DUPLICATE KEY UPDATE code = VALUES(code);

INSERT INTO lottery_modalities (lottery_id, code, name, is_active, sort_order)
SELECT id, 'MEGA_REVENTADO', 'Mega Reventado', TRUE, 20 FROM lotteries WHERE code = 'TICA'
ON DUPLICATE KEY UPDATE code = VALUES(code);

INSERT INTO lottery_modalities (lottery_id, code, name, is_active, sort_order)
SELECT id, 'NORMAL', 'Normal', TRUE, 10 FROM lotteries WHERE code = 'PRIMERA'
ON DUPLICATE KEY UPDATE code = VALUES(code);

INSERT INTO draw_schedules (lottery_modality_id, code, local_time, default_close_minutes_before, is_active)
SELECT lm.id, schedule_data.code, schedule_data.local_time, 10, TRUE
FROM lottery_modalities lm
JOIN lotteries l ON l.id = lm.lottery_id
CROSS JOIN (
  SELECT '1100' AS code, CAST('11:00:00' AS TIME) AS local_time
  UNION ALL SELECT '1500', CAST('15:00:00' AS TIME)
  UNION ALL SELECT '1800', CAST('18:00:00' AS TIME)
  UNION ALL SELECT '2100', CAST('21:00:00' AS TIME)
) schedule_data
WHERE l.code = 'NICA' AND lm.code = 'NORMAL'
ON DUPLICATE KEY UPDATE code = VALUES(code);

INSERT INTO draw_schedules (lottery_modality_id, code, local_time, default_close_minutes_before, is_active)
SELECT lm.id, schedule_data.code, schedule_data.local_time, 10, TRUE
FROM lottery_modalities lm
JOIN lotteries l ON l.id = lm.lottery_id
CROSS JOIN (
  SELECT '1300' AS code, CAST('13:00:00' AS TIME) AS local_time
  UNION ALL SELECT '1630', CAST('16:30:00' AS TIME)
  UNION ALL SELECT '1930', CAST('19:30:00' AS TIME)
) schedule_data
WHERE l.code = 'TICA' AND lm.code IN ('NORMAL', 'MEGA_REVENTADO')
ON DUPLICATE KEY UPDATE code = VALUES(code);

INSERT INTO draw_schedules (lottery_modality_id, code, local_time, default_close_minutes_before, is_active)
SELECT lm.id, schedule_data.code, schedule_data.local_time, 10, TRUE
FROM lottery_modalities lm
JOIN lotteries l ON l.id = lm.lottery_id
CROSS JOIN (
  SELECT '1000' AS code, CAST('10:00:00' AS TIME) AS local_time
  UNION ALL SELECT '1700', CAST('17:00:00' AS TIME)
) schedule_data
WHERE l.code = 'PRIMERA' AND lm.code = 'NORMAL'
ON DUPLICATE KEY UPDATE code = VALUES(code);

INSERT IGNORE INTO draw_schedule_weekdays (draw_schedule_id, iso_weekday)
SELECT ds.id, weekdays.iso_weekday
FROM draw_schedules ds
JOIN lottery_modalities lm ON lm.id = ds.lottery_modality_id
JOIN lotteries l ON l.id = lm.lottery_id
CROSS JOIN (
  SELECT 1 AS iso_weekday
  UNION ALL SELECT 2
  UNION ALL SELECT 3
  UNION ALL SELECT 4
  UNION ALL SELECT 5
  UNION ALL SELECT 6
  UNION ALL SELECT 7
) weekdays
WHERE l.code = 'NICA' AND lm.code = 'NORMAL' AND ds.code IN ('1100', '1500', '2100');

INSERT IGNORE INTO draw_schedule_weekdays (draw_schedule_id, iso_weekday)
SELECT ds.id, weekdays.iso_weekday
FROM draw_schedules ds
JOIN lottery_modalities lm ON lm.id = ds.lottery_modality_id
JOIN lotteries l ON l.id = lm.lottery_id
CROSS JOIN (
  SELECT 2 AS iso_weekday
  UNION ALL SELECT 6
  UNION ALL SELECT 7
) weekdays
WHERE l.code = 'NICA' AND lm.code = 'NORMAL' AND ds.code = '1800';

INSERT IGNORE INTO draw_schedule_weekdays (draw_schedule_id, iso_weekday)
SELECT ds.id, weekdays.iso_weekday
FROM draw_schedules ds
JOIN lottery_modalities lm ON lm.id = ds.lottery_modality_id
JOIN lotteries l ON l.id = lm.lottery_id
CROSS JOIN (
  SELECT 1 AS iso_weekday
  UNION ALL SELECT 2
  UNION ALL SELECT 3
  UNION ALL SELECT 4
  UNION ALL SELECT 5
  UNION ALL SELECT 6
  UNION ALL SELECT 7
) weekdays
WHERE l.code IN ('TICA', 'PRIMERA');
