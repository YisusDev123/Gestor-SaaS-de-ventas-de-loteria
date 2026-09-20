import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { canApplyPwaUpdate } from '../utils/pwa-update.js';
import { PwaStatus } from './PwaStatus.jsx';

describe('estado PWA', () => {
  it('explica que las ventas requieren internet al perder conexión', () => {
    const client = new QueryClient();
    render(<QueryClientProvider client={client}><PwaStatus /></QueryClientProvider>);
    fireEvent(window, new Event('offline'));
    expect(screen.getByText('Sin conexión.')).toBeInTheDocument();
    expect(screen.getByText(/ventas y datos privados requieren internet/)).toBeInTheDocument();
  });

  it('impide aplicar una actualización durante una mutación activa', () => {
    expect(canApplyPwaUpdate(1)).toBe(false);
    expect(canApplyPwaUpdate(0)).toBe(true);
  });
});
