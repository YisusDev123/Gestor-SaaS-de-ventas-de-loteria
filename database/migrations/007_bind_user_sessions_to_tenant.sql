ALTER TABLE user_sessions
  ADD COLUMN tenant_id BIGINT UNSIGNED NULL AFTER user_id,
  ADD COLUMN membership_id BIGINT UNSIGNED NULL AFTER tenant_id,
  ADD KEY ix_user_sessions_tenant_user (tenant_id, user_id),
  ADD KEY ix_user_sessions_membership (membership_id),
  ADD CONSTRAINT fk_user_sessions_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_user_sessions_membership
    FOREIGN KEY (membership_id) REFERENCES tenant_memberships (id) ON DELETE RESTRICT;

-- Esta migración se aplica antes de emitir sesiones reales. Las columnas quedan
-- obligatorias después de permitir una transición segura desde instalaciones vacías.
ALTER TABLE user_sessions
  MODIFY tenant_id BIGINT UNSIGNED NOT NULL,
  MODIFY membership_id BIGINT UNSIGNED NOT NULL;
