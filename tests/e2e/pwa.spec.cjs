const { test, expect } = require('@playwright/test');

test('aggiorna la cache corretta e riapre shell e asset senza connessione', async ({ page, context }) => {
  // Prepara cache obsolete prima che l'app registri il service worker.
  await page.goto('/manifest.json');
  await page.evaluate(async () => {
    await caches.open('sapori-%2F-v59-111111111111');
    await caches.open('sapori-%2Faltra-app%2F-v59-222222222222');
    await caches.open('sapori-v58');
    await caches.open('cache-di-un-altra-app');
  });

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

  await expect.poll(async () => page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    const scopePath = new URL(registration.scope).pathname;
    const prefix = `sapori-${encodeURIComponent(scopePath)}-`;
    const names = await caches.keys();
    return names.filter(name => name.startsWith(prefix));
  })).toEqual([expect.stringMatching(/^sapori-%2F-v\d+-[a-f0-9]{12}$/)]);

  const cacheState = await page.evaluate(async () => {
    const names = await caches.keys();
    return { names };
  });

  expect(cacheState.names).not.toContain('sapori-%2F-v59-111111111111');
  expect(cacheState.names).not.toContain('sapori-v58');
  expect(cacheState.names).toContain('sapori-%2Faltra-app%2F-v59-222222222222');
  expect(cacheState.names).toContain('cache-di-un-altra-app');

  await context.setOffline(true);

  const cachedAsset = await page.evaluate(async () => {
    const response = await fetch('./js/bootstrap-theme.js');
    return {
      ok: response.ok,
      containsThemeCode: (await response.text()).includes('sapori-theme')
    };
  });
  expect(cachedAsset).toEqual({ ok: true, containsThemeCode: true });

  await page.goto('/verifica-offline', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveTitle(/Sapori/);
  await expect(page.locator('#app-content')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Nuova ricetta' })).toBeVisible();

  await page.goto('/index.html?pwa-test=1#account', { waitUntil: 'domcontentloaded' });
  await expect(
    page.getByRole('heading', { name: 'Account e sincronizzazione', level: 1 })
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Prepara questo dispositivo' })).toBeVisible();
});
