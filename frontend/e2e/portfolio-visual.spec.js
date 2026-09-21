import { expect, test } from '@playwright/test';

test.skip(process.env.CI === 'true', 'Las referencias visuales del portafolio se generan en Windows.');

const sellerSession = {
  accessToken: 'portfolio-demo-token',
  tokenType: 'Bearer',
  expiresIn: 900,
  user: { id: 'user-demo', email: 'demo@example.com' },
  tenant: {
    id: 'tenant-demo',
    name: 'Comercial Demo',
    timezone: 'America/Costa_Rica',
    currencyCode: 'CRC',
  },
  role: 'OWNER',
  subscription: {
    status: 'ACTIVE',
    accessEndsAt: '2026-12-31T23:59:59.000Z',
    renewalRequired: false,
  },
};

const dashboard = {
  businessDate: '2026-09-20',
  sales: {
    grossAmount: '485750.00',
    cancelledAmount: '12500.00',
    netAmount: '473250.00',
    ticketCount: 186,
  },
  cash: {
    openingBalance: '100000.00',
    currentBalance: '438900.00',
    ledgerBalance: '438900.00',
    isBalanced: true,
  },
  exposure: { openAmount: '92500.00' },
  prizes: {
    generatedAmount: '68750.00',
    paidAmount: '42350.00',
    pendingAmount: '26400.00',
    pendingCount: 7,
  },
  operation: {
    expensesAmount: '5500.00',
    cashEntriesAmount: '18000.00',
    cashWithdrawalsAmount: '0.00',
    adjustmentCreditsAmount: '0.00',
    adjustmentDebitsAmount: '0.00',
    adjustmentsNetAmount: '0.00',
  },
  result: { provisionalAmount: '0.00', realizedAmount: '0.00' },
  upcomingDraws: [
    {
      drawPublicId: 'draw-demo-1',
      lotteryName: 'Sorteo Nacional',
      modalityName: 'Tarde',
      closesAt: '2026-09-20T19:50:00.000Z',
    },
    {
      drawPublicId: 'draw-demo-2',
      lotteryName: 'Sorteo Popular',
      modalityName: 'Noche',
      closesAt: '2026-09-21T01:20:00.000Z',
    },
  ],
  alerts: [],
};

async function mockSessionFailures(page) {
  await page.route('http://127.0.0.1:2000/**', async (route) => {
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ success: false, error: { message: 'Sesión no iniciada.' } }),
    });
  });
}

async function mockDashboard(page) {
  await page.route('http://127.0.0.1:2000/**', async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === '/auth/refresh') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: sellerSession }),
      });
      return;
    }
    if (pathname === '/reports/dashboard') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: dashboard }),
      });
      return;
    }
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ success: false, error: { message: 'Sesión no iniciada.' } }),
    });
  });
}

test('captura de acceso para el portafolio', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-escritorio');
  await mockSessionFailures(page);
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Iniciar sesión' })).toBeVisible();
  await expect(page).toHaveScreenshot('acceso-saas.png', {
    animations: 'disabled',
    fullPage: true,
  });
});

test('captura de dashboard con datos ficticios para el portafolio', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-escritorio');
  await mockDashboard(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Hola, Comercial Demo' })).toBeVisible();
  await expect(page).toHaveScreenshot('dashboard-saas.png', {
    animations: 'disabled',
    fullPage: true,
  });
});
