const { test, expect } = require('@playwright/test');

test('installa la PWA e riapre la shell senza connessione', async ({ page, context }) => {
  await page.goto('/index.html?pwa-test=1');

  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (navigator.serviceWorker.controller) return;

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Il service worker non ha preso il controllo della pagina')),
        10000
      );
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        clearTimeout(timeout);
        resolve();
      }, { once: true });
    });
  });

  await page.reload({ waitUntil: 'networkidle' });
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await expect.poll(() => page.evaluate(async () => {
    return (await caches.keys()).filter(name => /^sapori-v\d+$/.test(name)).length;
  })).toBe(1);

  await context.setOffline(true);
  await page.goto('/verifica-offline', { waitUntil: 'domcontentloaded' });

  await expect(page).toHaveTitle(/Sapori/);
  await expect(page.locator('#app-content')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Nuova ricetta' })).toBeVisible();
});
