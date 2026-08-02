const { test, expect } = require('@playwright/test');

const LONG_TEXT = 'TestoMoltoLungoSenzaSpaziPerControllareCheOgniVistaRientriDavveroNelViewportMobile';

async function openApp(page, width, hash = '') {
  await page.setViewportSize({ width, height: 860 });
  await page.addInitScript(() => {
    localStorage.setItem('sapori-warning-dismissed', 'true');
  });
  await page.goto('/index.html?mobile-overflow-e2e=1' + hash);
}

async function expectNoDocumentOverflow(page, label) {
  const metrics = await page.evaluate(() => {
    const viewport = window.innerWidth;
    const documentWidth = Math.max(
      document.documentElement.scrollWidth,
      document.body ? document.body.scrollWidth : 0
    );
    const offenders = Array.from(document.querySelectorAll('body *'))
      .map(element => {
        const rect = element.getBoundingClientRect();
        return {
          selector: element.id
            ? '#' + element.id
            : element.classList.length
              ? '.' + Array.from(element.classList).slice(0, 2).join('.')
              : element.tagName.toLowerCase(),
          left: Math.round(rect.left),
          right: Math.round(rect.right)
        };
      })
      .filter(item => item.left < -1 || item.right > viewport + 1)
      .slice(0, 8);

    return { viewport, documentWidth, offenders };
  });

  expect(
    metrics.documentWidth,
    `${label}: ${JSON.stringify(metrics.offenders)}`
  ).toBeLessThanOrEqual(metrics.viewport + 1);
}

test('non maschera overflow nelle viste principali fra 320 e 430 pixel', async ({ page }) => {
  for (const width of [320, 360, 390, 430]) {
    await openApp(page, width);
    const recipeId = await page.evaluate(async longText => DB.addRecipe({
      name: longText,
      category: 'altro',
      description: longText,
      ingredients: [{ name: longText, quantity: '100', unit: 'g', notes: longText }],
      steps: [{ text: longText, notes: longText }],
      prepTime: 10,
      cookTime: 15,
      servings: 4,
      difficulty: 'facile',
      notes: longText,
      storage: longText,
      image: null,
      imageThumbnail: null,
      isFavorite: false
    }), LONG_TEXT);

    await page.reload();
    await expect(page.locator('.recipe-card').first()).toBeVisible();
    await expectNoDocumentOverflow(page, `home ${width}px`);

    await page.goto('/index.html?mobile-overflow-e2e=1#detail/' + encodeURIComponent(recipeId));
    await expect(page.locator('.recipe-detail')).toBeVisible();
    await expectNoDocumentOverflow(page, `dettaglio ${width}px`);

    await page.getByRole('button', { name: /Modalit.+ cucina/ }).click();
    await expect(page.locator('.cooking-modal')).toBeVisible();
    await expectNoDocumentOverflow(page, `modalità cucina ${width}px`);
    await page.getByRole('button', { name: /Chiudi modalit.+ cucina/ }).click();

    await page.goto(
      '/index.html?mobile-overflow-e2e=1#create/overflow-' + width + '-' + Date.now()
    );
    await expect(page.locator('#recipe-form')).toBeVisible();
    await page.locator('#input-name').fill(LONG_TEXT);
    await expectNoDocumentOverflow(page, `form ${width}px`);

    await page.goto('/index.html?mobile-overflow-e2e=1&view=account-' + width + '#account');
    await expect(page.getByRole('heading', { name: 'Account e sincronizzazione', level: 1 })).toBeVisible();
    await expectNoDocumentOverflow(page, `account ${width}px`);

    await page.evaluate(async ({ width: viewportWidth, longText }) => {
      await DraftStore.save({
        mode: 'create',
        recipeId: null,
        draftId: 'overflow-' + viewportWidth + '-' + Date.now()
      }, {
        schemaVersion: 1,
        recipe: {
          id: null,
          name: longText,
          category: 'altro',
          description: longText,
          ingredients: [{ name: longText, quantity: '100', unit: 'g', notes: '' }],
          steps: [{ text: longText, notes: longText }],
          prepTime: 0,
          cookTime: 0,
          servings: 4,
          difficulty: 'facile',
          notes: longText,
          storage: longText,
          image: null,
          imageThumbnail: null,
          isFavorite: false,
          createdAt: Date.now(),
          updatedAt: Date.now()
        },
        activeTab: 'tab-info',
        baseContentVersion: 0,
        baseUpdatedAt: null
      }, {
        writerId: 'test-overflow',
        expectedRevision: null
      });
    }, { width, longText: LONG_TEXT });

    await page.goto('/index.html?mobile-overflow-e2e=1&view=drafts-' + width + '#drafts');
    await expect(page.getByRole('heading', { name: 'Bozze locali', level: 1 })).toBeVisible();
    await expect(page.locator('.draft-card').first()).toBeVisible();
    await expectNoDocumentOverflow(page, `bozze ${width}px`);
  }
});
