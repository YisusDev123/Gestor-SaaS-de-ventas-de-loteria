import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight, LockKeyhole, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { z } from 'zod';

import { useSession } from './session-context.js';

const loginFormSchema = z.object({
  email: z.email('Escribe un correo válido.'),
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres.'),
});

export function LoginPage({ scope }) {
  const isAdmin = scope === 'admin';
  const { seller, admin, signIn } = useSession();
  const activeSession = isAdmin ? admin : seller;
  const navigate = useNavigate();
  const location = useLocation();
  const [serverError, setServerError] = useState('');
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(loginFormSchema),
    defaultValues: { email: '', password: '' },
  });

  if (activeSession) return <Navigate to={isAdmin ? '/admin' : '/'} replace />;

  async function onSubmit(values) {
    setServerError('');
    try {
      const session = await signIn(scope, values);
      const fallback = isAdmin ? '/admin' : session.subscription.renewalRequired ? '/renovacion' : '/';
      navigate(location.state?.from || fallback, { replace: true });
    } catch (error) {
      setServerError(error.message || 'No fue posible iniciar sesión.');
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-story" aria-label="Presentación">
        <div className="brand-mark">GV</div>
        <p className="eyebrow">Gestión de ventas</p>
        <h1>{isAdmin ? 'Control seguro del servicio.' : 'Tu operación diaria, clara y en orden.'}</h1>
        <p>
          {isAdmin
            ? 'Acceso exclusivo para administración de suscripciones y clientes.'
            : 'Vende, consulta tu caja y entrega comprobantes desde cualquier dispositivo.'}
        </p>
        <div className="trust-note"><ShieldCheck size={20} /> Sesión protegida y datos privados por negocio</div>
      </section>

      <section className="auth-card" aria-labelledby="login-title">
        <div className="auth-card__icon"><LockKeyhole /></div>
        <p className="eyebrow">{isAdmin ? 'Administración SaaS' : 'Acceso de vendedor'}</p>
        <h2 id="login-title">Iniciar sesión</h2>
        <p className="muted">Ingresa con las credenciales entregadas para tu cuenta.</p>

        <form onSubmit={handleSubmit(onSubmit)} noValidate>
          <label>
            Correo electrónico
            <input type="email" autoComplete="username" inputMode="email" {...register('email')} />
            {errors.email && <span className="field-error">{errors.email.message}</span>}
          </label>
          <label>
            Contraseña
            <input type="password" autoComplete="current-password" {...register('password')} />
            {errors.password && <span className="field-error">{errors.password.message}</span>}
          </label>
          {serverError && <div className="alert alert--error" role="alert">{serverError}</div>}
          <button className="button button--primary button--wide" disabled={isSubmitting} type="submit">
            {isSubmitting ? 'Ingresando…' : 'Ingresar'} <ArrowRight size={18} />
          </button>
        </form>
        <p className="auth-switch">
          {isAdmin ? <a href="/login">Ir al acceso de vendedor</a> : <a href="/admin/login">Acceso administrativo</a>}
        </p>
      </section>
    </main>
  );
}
