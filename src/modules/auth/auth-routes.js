import { Router } from 'express';

import { contenedor } from '../../container/auth-container.js';
import {
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  webSessionSchema,
} from '../../schemas/auth-schema.js';
import { validar } from '../../shared/middleware/joi-schema.js';
import {
  passwordResetIdentityLimiter,
  passwordResetIpLimiter,
  sessionLimiter,
  userLoginIdentityLimiter,
  userLoginIpLimiter,
} from '../../shared/middleware/rate-limit.js';
import { requireTrustedOrigin } from '../../shared/middleware/trusted-origin.js';

const { controladorAuth, authMiddleware, membershipActivaMiddleware } = contenedor;
const router = Router();

router.get('/me', authMiddleware, membershipActivaMiddleware, controladorAuth.getMe);
router.get('/renewal', authMiddleware, membershipActivaMiddleware, controladorAuth.getRenewal);
router.post('/login', requireTrustedOrigin, userLoginIpLimiter, validar(loginSchema), userLoginIdentityLimiter, controladorAuth.login);
router.post('/forgot-password', passwordResetIpLimiter, validar(forgotPasswordSchema), passwordResetIdentityLimiter, controladorAuth.forgotPassword);
router.post('/reset-password', passwordResetIpLimiter, validar(resetPasswordSchema), controladorAuth.resetPassword);
router.post('/refresh', requireTrustedOrigin, sessionLimiter, validar(webSessionSchema), controladorAuth.refresh);
router.post('/logout', requireTrustedOrigin, sessionLimiter, validar(webSessionSchema), controladorAuth.logout);

export default router;
