import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ResetPasswordPage } from './ResetPasswordPage.jsx';

const validToken = 'A'.repeat(43);

describe('configuración inicial de contraseña', () => {
  afterEach(() => vi.restoreAllMocks());

  it('canjea el token por una contraseña y nunca lo usa como login', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: { message: 'Contraseña actualizada.' },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    render(<MemoryRouter initialEntries={[`/configurar-acceso?token=${validToken}`]}><ResetPasswordPage /></MemoryRouter>);

    fireEvent.change(screen.getByLabelText('Nueva contraseña'), { target: { value: 'NuevaClave123' } });
    fireEvent.change(screen.getByLabelText('Repite la contraseña'), { target: { value: 'NuevaClave123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear contraseña' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      token: validToken,
      newPassword: 'NuevaClave123',
    });
    expect(await screen.findByRole('heading', { name: 'Contraseña creada' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ir al acceso de vendedor' })).toHaveAttribute('href', '/login');
  });
});
