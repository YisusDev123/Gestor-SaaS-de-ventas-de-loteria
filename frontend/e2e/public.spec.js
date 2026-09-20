import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

for (const route of ['/login', '/admin/login']) {
  test(`@a11y ${route} no presenta violaciones automáticas`, async ({ page }) => {
    await page.goto(route);
    await expect(page.getByRole('heading', { name: 'Iniciar sesión' })).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(results.violations).toEqual([]);
  });
}

test('el teclado encuentra primero el salto al contenido y recorre el formulario', async ({ page }) => {
  await page.goto('/login');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Saltar al contenido principal' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('input[type="email"]')).toBeFocused();
});

test('@a11y el acceso expone nombres y roles útiles al lector de pantalla', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Iniciar sesión' })).toBeVisible();
  const ariaTree = await page.locator('#main-content').ariaSnapshot();
  expect(ariaTree).toContain('heading "Iniciar sesión"');
  expect(ariaTree).toContain('textbox "Correo electrónico"');
  expect(ariaTree).toContain('button "Ingresar"');
});

test('la PWA publica manifest y service worker sin interceptar la API', async ({ request }) => {
  const manifest = await request.get('/manifest.webmanifest');
  expect(manifest.ok()).toBeTruthy();
  expect((await manifest.json()).display).toBe('standalone');
  const worker = await request.get('/sw.js');
  expect(worker.ok()).toBeTruthy();
  expect(await worker.text()).not.toContain('BackgroundSyncPlugin');
});

test('@performance la pantalla pública respeta el presupuesto de navegación local', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium');
  await page.goto('/login');
  const timing = await page.evaluate(() => {
    const navigation = performance.getEntriesByType('navigation')[0];
    return { domContentLoaded: navigation.domContentLoadedEventEnd, load: navigation.loadEventEnd };
  });
  expect(timing.domContentLoaded).toBeLessThan(2500);
  expect(timing.load).toBeLessThan(3000);
});
