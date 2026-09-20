import { zodResolver } from '@hookform/resolvers/zod';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useSearchParams } from 'react-router-dom';
import { z } from 'zod';

import { apiRequest } from '../../shared/api/api-client.js';

const resetFormSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'El código de configuración no es válido.'),
  newPassword: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres.').max(128),
  confirmation: z.string(),
}).refine((value) => value.newPassword === value.confirmation, {
  message: 'Las contraseñas no coinciden.',
  path: ['confirmation'],
});

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const [completed, setCompleted] = useState(false);
  const [serverError, setServerError] = useState('');
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(resetFormSchema),
    defaultValues: {
      token: searchParams.get('token') || '',
      newPassword: '',
      confirmation: '',
    },
  });

  async function onSubmit(values) {
    setServerError('');
    try {
      await apiRequest('/auth/reset-password', {
        method: 'POST',
        body: { token: values.token, newPassword: values.newPassword },
        allowRefresh: false,
      });
      window.history.replaceState({}, '', '/configurar-acceso');
      setCompleted(true);
    } catch (error) {
      setServerError(error.message || 'No fue posible configurar la contraseña.');
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-story" aria-label="Presentación">
        <div className="brand-mark">GV</div>
        <p className="eyebrow">Gestión de ventas</p>
        <h1>Crea tu acceso seguro.</h1>
        <p>El código entregado por el administrador se utiliza una sola vez para elegir tu contraseña.</p>
        <div className="trust-note"><ShieldCheck size={20} /> El código no es una contraseña y expira automáticamente</div>
      </section>

      <section className="auth-card" aria-labelledby="reset-title">
        <div className="auth-card__icon"><KeyRound /></div>
        <p className="eyebrow">Primer acceso</p>
        <h2 id="reset-title">{completed ? 'Contraseña creada' : 'Crear contraseña'}</h2>
        {completed ? (
          <div className="stack-form">
            <p className="alert alert--success" role="status">Tu contraseña quedó configurada. El código anterior ya no puede volver a utilizarse.</p>
            <Link className="button button--primary button--wide" to="/login">Ir al acceso de vendedor</Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} noValidate>
            <label>
              Código de configuración
              <input autoComplete="one-time-code" spellCheck="false" {...register('token')} />
              {errors.token && <span className="field-error">{errors.token.message}</span>}
            </label>
            <label>
              Nueva contraseña
              <input type="password" autoComplete="new-password" {...register('newPassword')} />
              {errors.newPassword && <span className="field-error">{errors.newPassword.message}</span>}
            </label>
            <label>
              Repite la contraseña
              <input type="password" autoComplete="new-password" {...register('confirmation')} />
              {errors.confirmation && <span className="field-error">{errors.confirmation.message}</span>}
            </label>
            {serverError && <div className="alert alert--error" role="alert">{serverError}</div>}
            <button className="button button--primary button--wide" disabled={isSubmitting} type="submit">
              {isSubmitting ? 'Guardando…' : 'Crear contraseña'}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
