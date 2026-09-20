import { createHash } from 'node:crypto';

import bcrypt from 'bcrypt';

import { AppError } from '../../shared/error/app-error.js';
import { hashPasswordResetToken, hashRefreshToken } from './auth-token.js';

const DUMMY_PASSWORD_HASH = '$2b$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW';
const PASSWORD_RESET_RESPONSE = 'Si existe una cuenta disponible, recibirás instrucciones para restablecer tu contraseña.';

function errorCredenciales() {
  return new AppError('Correo o contraseña incorrectos.', {
    statusCode: 401,
    code: 'INVALID_CREDENTIALS',
  });
}

function validarAccesoContexto(contexto) {
  if (!contexto || contexto.userStatus !== 'ACTIVE'
    || contexto.membershipStatus !== 'ACTIVE' || contexto.tenantStatus !== 'ACTIVE') {
    throw new AppError('La cuenta no está disponible.', {
      statusCode: 403,
      code: 'ACCOUNT_UNAVAILABLE',
    });
  }
}

function crearContenidoPublico(contexto, accessToken, expiresIn) {
  return {
    ...(accessToken ? { accessToken, tokenType: 'Bearer', expiresIn } : {}),
    user: {
      id: contexto.userPublicId,
      email: contexto.email,
    },
    tenant: {
      id: contexto.tenantPublicId,
      name: contexto.tenantName,
      timezone: contexto.timezone,
      currencyCode: contexto.currencyCode,
    },
    role: contexto.role,
    subscription: {
      status: contexto.subscriptionStatus,
      accessEndsAt: contexto.accessEndsAt,
      renewalRequired: Number(contexto.hasAccess) !== 1,
    },
  };
}

function obtenerMetadataCliente(ip, userAgent) {
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

export async function login(baseDeDatos, tokenManager, email, password, ip, userAgent) {
  const contextos = await baseDeDatos.buscarContextosPorEmail(email);
  const candidato = contextos.length === 1 ? contextos[0] : null;
  const passwordCorrecta = await bcrypt.compare(
    password,
    candidato?.passwordHash || DUMMY_PASSWORD_HASH,
  );
  if (!candidato || !passwordCorrecta) throw errorCredenciales();
  validarAccesoContexto(candidato);

  const refresh = tokenManager.createRefreshToken();
  const refreshExpiresAt = tokenManager.refreshExpiry();
  const sesion = await baseDeDatos.registrarLoginTransaccional(
    candidato.membershipId,
    candidato.passwordHash,
    {
      ...obtenerMetadataCliente(ip, userAgent),
      tokenHash: refresh.hash,
      familyId: tokenManager.newFamilyId(),
      expiresAt: refreshExpiresAt,
    },
  );
  const accessToken = tokenManager.issueAccessToken(sesion.contexto, sesion.sessionId);
  return {
    contenido: crearContenidoPublico(
      sesion.contexto,
      accessToken,
      tokenManager.accessTokenTtlSeconds,
    ),
    refreshToken: refresh.raw,
    refreshExpiresAt,
  };
}

export async function refrescarToken(baseDeDatos, tokenManager, refreshToken, ip, userAgent) {
  const nextRefresh = tokenManager.createRefreshToken();
  const refreshExpiresAt = tokenManager.refreshExpiry();
  const resultado = await baseDeDatos.refrescarSesionTransaccional(
    hashRefreshToken(refreshToken),
    {
      ...obtenerMetadataCliente(ip, userAgent),
      tokenHash: nextRefresh.hash,
      expiresAt: refreshExpiresAt,
    },
  );

  if (resultado.reused) {
    throw new AppError('La sesión fue revocada por seguridad.', {
      statusCode: 401,
      code: 'REFRESH_TOKEN_REUSED',
    });
  }
  if (resultado.invalid) {
    throw new AppError('La sesión de renovación no es válida o expiró.', {
      statusCode: 401,
      code: 'INVALID_REFRESH_TOKEN',
    });
  }

  const accessToken = tokenManager.issueAccessToken(resultado.contexto, resultado.sessionId);
  return {
    contenido: crearContenidoPublico(
      resultado.contexto,
      accessToken,
      tokenManager.accessTokenTtlSeconds,
    ),
    refreshToken: nextRefresh.raw,
    refreshExpiresAt,
  };
}

export async function logout(baseDeDatos, refreshToken) {
  await baseDeDatos.cerrarSesionTransaccional(hashRefreshToken(refreshToken));
  return { loggedOut: true };
}

export function obtenerPerfil(contexto) {
  validarAccesoContexto(contexto);
  return crearContenidoPublico(contexto);
}

export function obtenerRenovacion(contexto) {
  validarAccesoContexto(contexto);
  return {
    tenant: { id: contexto.tenantPublicId, name: contexto.tenantName },
    subscription: {
      status: contexto.subscriptionStatus,
      accessEndsAt: contexto.accessEndsAt,
      renewalRequired: Number(contexto.hasAccess) !== 1,
    },
  };
}

export async function solicitarRestablecimiento(
  baseDeDatos,
  tokenManager,
  proveedorRecuperacionAcceso,
  email,
) {
  const usuario = await baseDeDatos.buscarUsuarioRecuperacionPorEmail(email);
  if (!usuario) return { message: PASSWORD_RESET_RESPONSE };

  const token = tokenManager.createPasswordResetToken();
  const expiresAt = tokenManager.passwordResetExpiry();
  const tokenId = await baseDeDatos.crearTokenRestablecimientoTransaccional(
    usuario.userId,
    token.hash,
    expiresAt,
  );
  if (!tokenId) return { message: PASSWORD_RESET_RESPONSE };

  try {
    await proveedorRecuperacionAcceso.enviarTokenRestablecimiento({
      to: usuario.email,
      token: token.raw,
      expiresAt,
      idempotencyKey: `password_reset_${tokenId}`,
    });
  } catch {
    // La respuesta permanece neutral para no revelar si el correo pertenece a una cuenta.
  }

  return { message: PASSWORD_RESET_RESPONSE };
}

export async function confirmarRestablecimiento(baseDeDatos, token, newPassword) {
  const passwordHash = await bcrypt.hash(newPassword, 12);
  const actualizado = await baseDeDatos.restablecerPasswordTransaccional(
    hashPasswordResetToken(token),
    passwordHash,
  );
  if (!actualizado) {
    throw new AppError('El enlace de restablecimiento no es válido o expiró.', {
      statusCode: 400,
      code: 'INVALID_PASSWORD_RESET_TOKEN',
    });
  }
  return {
    message: 'Contraseña actualizada. Inicia sesión nuevamente en todos tus dispositivos.',
  };
}
