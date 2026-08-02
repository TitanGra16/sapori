const { test, expect } = require('@playwright/test');

async function openCleanApp(page, width) {
  await page.setViewportSize({ width, height: 860 });
  await page.addInitScript(() => {
    localStorage.setItem('sapori-warning-dismissed', 'true');
  });
  await page.goto('/index.html?mobile-controls-e2e=1');
}

async function expectTouchTarget(locator, label) {
  const box = await locator.boundingBox();
  expect(box, label).not.toBeNull();
  expect(box.width, `${label}: larghezza`).toBeGreaterThanOrEqual(44);
  expect(box.height, `${label}: altezza`).toBeGreaterThanOrEqual(44);
}

test('mantiene utilizzabili i controlli principali fra 360 e 430 pixel', async ({ page }) => {
  for (const width of [360, 390, 430]) {
    await openCleanApp(page, width);

    await expectTouchTarget(page.locator('#sort-select'), 'ordinamento');
    await page.locator('#btn-search-toggle').click();
    await expectTouchTarget(page.locator('#btn-search-close'), 'chiusura ricerca');

    const recipeId = await page.evaluate(async () => DB.addRecipe({
      name: 'Controlli mobile',
      category: 'altro',
      description: 'Ricetta usata per verificare i controlli touch.',
      ingredients: [{ name: 'Farina', quantity: '100', unit: 'g', notes: '' }],
      steps: [{ text: 'Impasta.', notes: '' }],
      prepTime: 10,
      cookTime: 15,
      servings: 4,
      difficulty: 'facile',
      notes: '',
      storage: '',
      image: null,
      imageThumbnail: null,
      isFavorite: false
    }));

    await page.goto('/index.html?mobile-controls-e2e=1#detail/' + encodeURIComponent(recipeId));
    await expect(page.getByRole('heading', { name: 'Controlli mobile' })).toBeVisible();
    await expectTouchTarget(page.getByRole('button', { name: 'Indietro' }), 'indietro');
    await expectTouchTarget(page.getByRole('button', { name: 'Riduci porzioni' }), 'riduci porzioni');
    await expectTouchTarget(page.getByRole('button', { name: 'Aumenta porzioni' }), 'aumenta porzioni');

    const viewportFits = await page.evaluate(() => (
      document.documentElement.scrollWidth <= window.innerWidth + 1
    ));
    expect(viewportFits, `overflow a ${width}px`).toBe(true);
  }
});
