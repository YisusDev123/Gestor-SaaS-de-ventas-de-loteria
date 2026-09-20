import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiRequest } from '../../shared/api/api-client.js';
import { SalesPage } from './SalesPage.jsx';

vi.mock('../../shared/api/api-client.js', () => ({ apiRequest: vi.fn() }));

const draw = {
  drawPublicId: 'DRAW-1',
  businessDate: '2026-09-18',
  scheduledAt: '2026-09-18T17:00:00.000Z',
  closesAt: '2026-09-18T16:50:00.000Z',
  status: 'OPEN',
  lottery: { code: 'NICA', name: 'Nica' },
  modality: { code: 'NORMAL', name: 'Normal' },
  multiplier: '80.00',
  totalSoldAmount: '0.00',
  validTicketCount: 0,
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter><SalesPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('venta con selección múltiple', () => {
  beforeEach(() => {
    apiRequest.mockReset();
    apiRequest.mockImplementation((path) => {
      if (path.startsWith('/sales/draws?')) {
        return Promise.resolve({ data: { businessDate: draw.businessDate, draws: [draw], warnings: [] } });
      }
      if (path === '/sales/draws/DRAW-1/numbers') {
        return Promise.resolve({
          data: {
            draw,
            numbers: ['02', '00', '01'].map((number) => ({
              number,
              effectiveLimit: '10000.00',
              soldAmount: '0.00',
              remainingAmount: '10000.00',
              validTicketCount: 0,
            })),
          },
        });
      }
      return Promise.reject(new Error(`Ruta inesperada: ${path}`));
    });
  });

  it('marca varios números y agrega el mismo monto a cada uno', async () => {
    renderPage();

    const number00 = await screen.findByRole('button', { name: /^Número 00,/ });
    const number01 = screen.getByRole('button', { name: /^Número 01,/ });
    expect(screen.getByLabelText('Sorteo y modalidad')).toHaveValue('DRAW-1');
    expect(screen.getAllByRole('button', { name: /^Número/ }).map((button) => button.querySelector('strong').textContent)).toEqual(['00', '01', '02']);
    expect(number00).toHaveClass('list-number', 'sales-number');
    expect(number00.parentElement).toHaveClass('list-number-grid', 'sales-number-grid');
    fireEvent.click(number00);
    fireEvent.click(number01);

    expect(number00).toHaveAttribute('aria-pressed', 'true');
    expect(number01).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Agregar (2)' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Monto'), { target: { value: '100.00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Agregar (2)' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Quitar número 00' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Quitar número 01' })).toBeInTheDocument();
    });
    expect(number00).toHaveAttribute('aria-pressed', 'false');
    expect(number01).toHaveAttribute('aria-pressed', 'false');
  });

  it('deshabilita el zoom solo mientras la pantalla de ventas esta abierta', async () => {
    const viewport = document.createElement('meta');
    const originalContent = 'width=device-width, initial-scale=1.0, viewport-fit=cover';
    viewport.setAttribute('name', 'viewport');
    viewport.setAttribute('content', originalContent);
    document.head.append(viewport);

    const page = renderPage();
    await screen.findByRole('heading', { name: 'Nueva venta' });

    expect(viewport.getAttribute('content')).toContain('maximum-scale=1.0');
    expect(viewport.getAttribute('content')).toContain('user-scalable=no');

    page.unmount();
    expect(viewport).toHaveAttribute('content', originalContent);
    viewport.remove();
  });
});
