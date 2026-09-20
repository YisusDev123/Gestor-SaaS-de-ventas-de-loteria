import { createHash, randomBytes } from 'node:crypto';

import bcrypt from 'bcrypt';

import { AppError } from '../../shared/error/app-error.js';
import { createCursorCodec } from '../../shared/utils/cursor.js';
import { formatMoney, parseMoney } from '../../shared/utils/money.js';
import { createPublicId } from '../../shared/utils/public-id.js';
import { solicitarRecuperacionTenant } from '../jobs/jobs-recovery.js';
import { hashAdminRefreshToken } from './saas-admin-token.js';

const DUMMY_PASSWORD_HASH = '$2b$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW';

function decodeCursor(secret, encoded) {
  if (!encoded) return null;
  try {
    const value = createCursorCodec(secret).decode(encoded);
    if (Object.keys(value).length !== 1 || typeof value.id !== 'string' || !/^[1-9]\d*$/.test(value.id)) throw new Error();
    return value;
  } catch {
    throw new AppError('El cursor no es válido.', { statusCode: 400, code: 'INVALID_CURSOR' });
  }
}

function page(secret, rows, limit) {
  const hasMore = rows.length > limit;
  const selected = hasMore ? rows.slice(0, limit) : rows;
  const last = selected.at(-1);
  return {
    items: selected.map(({ cursorId: _cursorId, ...item }) => item),
    limit,
    nextCursor: hasMore && last ? createCursorCodec(secret).encode({ id: last.cursorId }) : null,
  };
}

function metadataCliente(ip, userAgent) {
  const userAgentSeguro = typeof userAgent === 'string'
    ? [...userAgent].filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && code !== 127;
    }).join('').slice(0, 255)
    : null;
  return {
    ipHash: ip ? createHash('sha256').update(ip).digest() : null,
    userAgent: userAgentSeguro,
  };
}

function contenidoAdmin(admin, accessToken, expiresIn) {
  return {
    accessToken,
    tokenType: 'Bearer',
    expiresIn,
    admin: { email: admin.email, scope: 'SAAS_ADMIN' },
  };
}

async function prepararEntregaAcceso(proveedor, payload) {
  try {
    const entrega = await proveedor.enviarTokenRestablecimiento(payload);
    if (!entrega?.skipped) return { delivery: 'EMAIL' };
  } catch {
    // El administrador recibe el secreto una sola vez para entrega manual segura.
  }
  return {
    delivery: 'MANUAL',
    token: payload.token,
    expiresAt: payload.expiresAt,
  };
}

export async function login(baseDeDatos, tokenManager, email, password, ip, userAgent) {
  const admin = await baseDeDatos.buscarAdminPorEmail(email);
  const passwordCorrecta = await bcrypt.compare(
    password,
    admin?.passwordHash || DUMMY_PASSWORD_HASH,
  );
  if (!admin || !passwordCorrecta) {
    throw new AppError('Correo o contraseña incorrectos.', {
      statusCode: 401,
      code: 'INVALID_ADMIN_CREDENTIALS',
    });
  }
  if (admin.status !== 'ACTIVE') {
    throw new AppError('La cuenta administrativa no está disponible.', {
      statusCode: 403,
      code: 'ADMIN_ACCOUNT_UNAVAILABLE',
    });
  }
  const refresh = tokenManager.createRefreshToken();
  const refreshExpiresAt = tokenManager.refreshExpiry();
  const sesion = await baseDeDatos.registrarLoginAdminTransaccional(
    admin.adminId,
    admin.passwordHash,
    {
      ...metadataCliente(ip, userAgent),
      tokenHash: refresh.hash,
      familyId: tokenManager.newFamilyId(),
      expiresAt: refreshExpiresAt,
    },
  );
  return {
    contenido: contenidoAdmin(
      sesion.admin,
      tokenManager.issueAccessToken(sesion.admin.adminId, sesion.sessionId),
      tokenManager.accessTokenTtlSeconds,
    ),
    refreshToken: refresh.raw,
    refreshExpiresAt,
  };
}

export async function refrescarToken(baseDeDatos, tokenManager, refreshToken, ip, userAgent) {
  const nextRefresh = tokenManager.createRefreshToken();
  const refreshExpiresAt = tokenManager.refreshExpiry();
  const resultado = await baseDeDatos.refrescarAdminSesionTransaccional(
    hashAdminRefreshToken(refreshToken),
    {
      ...metadataCliente(ip, userAgent),
      tokenHash: nextRefresh.hash,
      expiresAt: refreshExpiresAt,
    },
  );
  if (resultado.reused) {
    throw new AppError('La sesión administrativa fue revocada por seguridad.', {
      statusCode: 401,
      code: 'ADMIN_REFRESH_TOKEN_REUSED',
    });
  }
  if (resultado.invalid) {
    throw new AppError('La sesión administrativa no es válida o expiró.', {
      statusCode: 401,
      code: 'INVALID_ADMIN_REFRESH_TOKEN',
    });
  }
  return {
    contenido: contenidoAdmin(
      resultado.admin,
      tokenManager.issueAccessToken(resultado.admin.adminId, resultado.sessionId),
      tokenManager.accessTokenTtlSeconds,
    ),
    refreshToken: nextRefresh.raw,
    refreshExpiresAt,
  };
}

export async function logout(baseDeDatos, refreshToken) {
  await baseDeDatos.cerrarAdminSesionTransaccional(hashAdminRefreshToken(refreshToken));
  return { loggedOut: true };
}

export function obtenerPerfil(adminEmail) {
  return { admin: { email: adminEmail, scope: 'SAAS_ADMIN' } };
}

export async function listarTenants(baseDeDatos, cursorSecret, query) {
  const rows = await baseDeDatos.listarTenants(
    query, decodeCursor(cursorSecret, query.cursor), query.limit + 1,
  );
  return page(cursorSecret, rows, query.limit);
}

export async function obtenerTenant(baseDeDatos, tenantPublicId) {
  const tenant = await baseDeDatos.obtenerTenant(tenantPublicId);
  if (!tenant) throw new AppError('El tenant solicitado no existe.', { statusCode: 404, code: 'TENANT_NOT_FOUND' });
  return tenant;
}

export async function listarPlanes(baseDeDatos) {
  return baseDeDatos.listarPlanes();
}

export async function listarAuditoria(baseDeDatos, cursorSecret, query) {
  const rows = await baseDeDatos.listarAuditoria(
    query, decodeCursor(cursorSecret, query.cursor), query.limit + 1,
  );
  return page(cursorSecret, rows, query.limit);
}

export async function crearTenant(
  baseDeDatos,
  userTokenManager,
  proveedorRecuperacion,
  adminId,
  input,
  correlationId,
  jobsService = null,
) {
  const reset = userTokenManager.createPasswordResetToken();
  const resetExpiresAt = userTokenManager.passwordResetExpiry();
  const unusablePasswordHash = await bcrypt.hash(randomBytes(32).toString('base64url'), 12);
  const tenantPublicId = createPublicId();
  const userPublicId = createPublicId();
  const creado = await baseDeDatos.crearTenantTransaccional(adminId, {
    ...input,
    tenantPublicId,
    userPublicId,
    unusablePasswordHash,
    resetTokenHash: reset.hash,
    resetExpiresAt,
    correlationId,
  });
  const accessSetup = await prepararEntregaAcceso(proveedorRecuperacion, {
    to: input.ownerEmail,
    token: reset.raw,
    expiresAt: resetExpiresAt,
    idempotencyKey: `tenant_access_setup_${creado.resetTokenId}`,
  });
  const recovery = await solicitarRecuperacionTenant(
    jobsService, creado.tenantId, 'TENANT_CREATED',
  );
  return {
    tenant: { id: tenantPublicId, displayName: input.displayName, status: 'ACTIVE' },
    owner: { id: userPublicId, email: input.ownerEmail },
    subscription: {
      status: 'TRIAL', planCode: creado.planCode, accessEndsAt: creado.trialEndsAt,
    },
    accessSetup,
    ...recovery,
  };
}

export async function cambiarEstadoTenant(
  baseDeDatos,
  adminId,
  tenantPublicId,
  input,
  correlationId,
  jobsService = null,
) {
  const resultado = await baseDeDatos.cambiarEstadoTenantTransaccional(
    adminId, tenantPublicId, input.status, input.reason ?? null, correlationId,
  );
  const { tenantId, ...publicResult } = resultado;
  const recovery = input.status === 'ACTIVE'
    ? await solicitarRecuperacionTenant(jobsService, tenantId, 'TENANT_REACTIVATED')
    : {};
  return { tenant: { id: tenantPublicId, ...publicResult }, ...recovery };
}

export async function restablecerAccesoTenant(
  baseDeDatos,
  userTokenManager,
  proveedorRecuperacion,
  adminId,
  tenantPublicId,
  correlationId,
) {
  const reset = userTokenManager.createPasswordResetToken();
  const expiresAt = userTokenManager.passwordResetExpiry();
  const creado = await baseDeDatos.crearRestablecimientoTenantTransaccional(
    adminId, tenantPublicId, reset.hash, expiresAt, correlationId,
  );
  const accessSetup = await prepararEntregaAcceso(proveedorRecuperacion, {
    to: creado.email,
    token: reset.raw,
    expiresAt,
    idempotencyKey: `tenant_access_reset_${creado.resetTokenId}`,
  });
  return { tenant: { id: tenantPublicId }, owner: { email: creado.email }, accessSetup };
}

export async function actualizarPrecioPlan(
  baseDeDatos,
  adminId,
  planCode,
  currentPrice,
  correlationId,
) {
  const precioNormalizado = formatMoney(parseMoney(currentPrice, { allowZero: false }));
  return baseDeDatos.actualizarPrecioPlanTransaccional(
    adminId, planCode, precioNormalizado, correlationId,
  );
}

export async function confirmarPagoSuscripcion(
  baseDeDatos,
  adminId,
  tenantPublicId,
  input,
  correlationId,
  jobsService = null,
) {
  const amount = formatMoney(parseMoney(input.amount, { allowZero: false }));
  const startsAt = new Date(input.startsAt);
  const accessEndsAt = new Date(input.accessEndsAt);
  const paidAt = new Date(input.paidAt);
  const canonicalPayload = JSON.stringify({
    tenantPublicId,
    amount,
    startsAt: startsAt.toISOString(),
    accessEndsAt: accessEndsAt.toISOString(),
    paidAt: paidAt.toISOString(),
    note: input.note ?? null,
  });
  const payloadFingerprint = createHash('sha256').update(canonicalPayload).digest();
  const result = await baseDeDatos.confirmarPagoSuscripcionTransaccional(adminId, tenantPublicId, {
    requestId: input.requestId,
    amount,
    startsAt,
    accessEndsAt,
    paidAt,
    note: input.note ?? null,
    payloadFingerprint,
    correlationId,
  });
  return {
    ...result,
    ...await solicitarRecuperacionTenant(jobsService, result.tenantId, 'SUBSCRIPTION_RENEWED'),
  };
}
