import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiRequest } from '../../shared/api/api-client.js';
import { ResultsPage } from './ResultsPage.jsx';

vi.mock('../../shared/api/api-client.js', () => ({ apiRequest: vi.fn() }));

const draw = {
  drawPublicId: '01J00000000000000000000000',
  lotteryName: 'Nica',
  modalityName: 'Normal',
  scheduledAt: '2026-09-18T17:00:00.000Z',
  status: 'CLOSED',
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ResultsPage />
    </QueryClientProvider>,
  );
}

describe('carga manual de resultados', () => {
  beforeEach(() => {
    sessionStorage.clear();
    apiRequest.mockReset();
    apiRequest.mockImplementation((path, options) => {
      if (path.startsWith('/sales/list?')) return Promise.resolve({ data: [draw] });
      if (path.startsWith('/reports/draws?')) return Promise.resolve({ data: [] });
      if (path === `/results/draws/${draw.drawPublicId}` && !options) {
        return Promise.resolve({ data: { ...draw, current: null, versions: [] } });
      }
      if (path === `/results/draws/${draw.drawPublicId}` && options?.method === 'POST') {
        return Promise.resolve({ data: { drawPublicId: draw.drawPublicId, status: 'RESULTED' } });
      }
      return Promise.reject(new Error(`Ruta inesperada: ${path}`));
    });
  });

  it('envia el resultado y su confirmacion como dos campos independientes', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Nica/ }));
    await screen.findByRole('heading', { name: 'Cargar resultado' });

    fireEvent.change(screen.getByLabelText('Número ganador'), { target: { value: '07' } });
    fireEvent.change(screen.getByLabelText('Confirmar número'), { target: { value: '07' } });
    fireEvent.click(screen.getByRole('button', { name: 'Publicar resultado' }));

    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(
      `/results/draws/${draw.drawPublicId}`,
      expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({
          winningNumber: '07',
          confirmWinningNumber: '07',
          confirmed: true,
          requestId: expect.any(String),
        }),
      }),
    ));
  });

  it('no permite publicar cuando los dos campos no coinciden', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Nica/ }));
    await screen.findByRole('heading', { name: 'Cargar resultado' });

    fireEvent.change(screen.getByLabelText('Número ganador'), { target: { value: '07' } });
    fireEvent.change(screen.getByLabelText('Confirmar número'), { target: { value: '08' } });

    expect(screen.getByRole('button', { name: 'Publicar resultado' })).toBeDisabled();
  });
});
