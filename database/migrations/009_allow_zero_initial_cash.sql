ALTER TABLE cash_movements
  DROP CHECK chk_cash_movements_amount,
  ADD CONSTRAINT chk_cash_movements_amount CHECK (
    (movement_type = 'INITIAL' AND amount >= 0)
    OR (movement_type <> 'INITIAL' AND amount > 0)
  );
