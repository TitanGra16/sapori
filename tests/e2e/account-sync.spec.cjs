const { test, expect } = require('@playwright/test');

async function openCleanApp(page) {
  await page.goto('/index.html?account-sync-e2e=1');
  const warningButton = page.getByRole('button', { name: 'Ho capito' });
  if (await warningButton.isVisible().catch(() => false)) {
    await warningButton.click();
  }
}

async function expectNoHorizontalOverflow(page) {
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    content: Math.max(
      document.documentElement.scrollWidth,
      document.body ? document.body.scrollWidth : 0
    )
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport + 1);
}

test.beforeEach(async ({ page }) => {
  await openCleanApp(page);
});

test('apre la schermata account e prepara il dispositivo senza richieste esterne', async ({ page }) => {
  const externalRequests = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.origin !== 'http://127.0.0.1:4173') externalRequests.push(request.url());
  });

  await page.getByRole('button', { name: 'Impostazioni' }).click();
  await expect(page.getByRole('heading', { name: 'Account e sincronizzazione', level: 2 })).toBeVisible();
  await page.getByRole('button', { name: 'Attiva sincronizzazione' }).click();

  await expect(page).toHaveURL(/#account$/);
  const title = page.getByRole('heading', { name: 'Account e sincronizzazione', level: 1 });
  await expect(title).toBeVisible();
  await expect(title).toBeFocused();
  await expect(page.locator('.nav-item[data-view="settings"]')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByText('Nessun dato viene inviato')).toBeVisible();
  await expect(page.getByText('Nessun account collegato')).toBeVisible();

  await page.getByRole('button', { name: 'Prepara questo dispositivo' }).click();
  await expect(page.getByText('Questo dispositivo è pronto')).toBeVisible();
  await expect(page.getByText(/nessun dato è stato caricato online/i)).toBeVisible();
  await expect.poll(() => page.evaluate(async () => {
    const status = await SyncPreparation.getStatus();
    return {
      prepared: status.preparationEnabled,
      cloud: status.cloudConnected,
      pending: status.pendingCount
    };
  })).toEqual({ prepared: true, cloud: false, pending: 1 });
  expect(externalRequests).toEqual([]);

  await page.reload();
  const warningAfterReload = page.getByRole('button', { name: 'Ho capito' });
  if (await warningAfterReload.isVisible().catch(() => false)) {
    await warningAfterReload.click();
  }
  await expect(page.getByText('Questo dispositivo è pronto')).toBeVisible();
  await page.getByRole('button', { name: 'Torna alle impostazioni' }).click();
  await expect(page).toHaveURL(/#settings$/);
  await expect(page.getByRole('button', { name: 'Vedi preparazione' })).toBeVisible();
});

test('mostra una coda persistente e compatta per le ricette locali', async ({ page }) => {
  const recipeId = await page.evaluate(async () => {
    return DB.addRecipe({
      name: 'Ricetta da sincronizzare',
      category: 'altro',
      description: '',
      ingredients: [{ name: 'Farina', quantity: '100', unit: 'g', notes: '' }],
      steps: [{ text: 'Impasta', notes: '' }],
      prepTime: 0,
      cookTime: 0,
      servings: 4,
      difficulty: 'media',
      notes: '',
      storage: '',
      image: null,
      imageThumbnail: null,
      isFavorite: false
    });
  });

  await page.goto('/index.html?account-sync-e2e=1#account');
  await page.getByRole('button', { name: 'Prepara questo dispositivo' }).click();
  await expect.poll(() => page.evaluate(async () => {
    const status = await SyncPreparation.getStatus();
    return [status.recipeCount, status.pendingRecipeCount, status.pendingCount];
  })).toEqual([1, 1, 3]);

  await page.evaluate(async id => {
    const recipe = await DB.getRecipe(id);
    await DB.updateRecipe({ ...recipe, name: 'Ricetta aggiornata' });
    await DB.toggleFavorite(id);
    await DB.deleteRecipe(id);
  }, recipeId);
  await page.reload();

  await expect.poll(() => page.evaluate(async id => {
    const status = await SyncPreparation.getStatus();
    const changes = await SyncPreparation.getPendingChanges();
    return {
      savedRecipes: status.recipeCount,
      queuedRecipes: status.pendingRecipeCount,
      operations: status.pendingCount,
      tombstones: changes.filter(change => (
        change.entityId === id &&
        change.channel === 'content' &&
        change.action === 'delete'
      )).length
    };
  }, recipeId)).toEqual({
    savedRecipes: 0,
    queuedRecipes: 1,
    operations: 2,
    tombstones: 1
  });
});

test('la schermata account non crea scorrimento orizzontale', async ({ page }) => {
  await page.goto('/index.html?account-sync-e2e=1#account');
  await expect(page.getByRole('heading', { name: 'Account e sincronizzazione', level: 1 })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.getByRole('button', { name: 'Prepara questo dispositivo' }).click();
  await expect(page.getByText('Questo dispositivo è pronto')).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('due schede condividono profilo e coda senza perdere modifiche', async ({ page, context }) => {
  const secondPage = await context.newPage();
  await secondPage.goto('/index.html?account-sync-tab=2');
  await Promise.all([
    page.evaluate(() => DB._ensureDB()),
    secondPage.evaluate(() => DB._ensureDB())
  ]);

  const [firstStatus, secondStatus] = await Promise.all([
    page.evaluate(() => SyncPreparation.prepareDevice()),
    secondPage.evaluate(() => SyncPreparation.prepareDevice())
  ]);
  expect(secondStatus.ownerScope).toBe(firstStatus.ownerScope);

  const recipeId = await secondPage.evaluate(() => DB.addRecipe({
    name: 'Ricetta dalla seconda scheda',
    category: 'altro',
    description: '',
    ingredients: [{ name: 'Farina', quantity: '100', unit: 'g', notes: '' }],
    steps: [{ text: 'Impasta', notes: '' }],
    prepTime: 0,
    cookTime: 0,
    servings: 4,
    difficulty: 'media',
    notes: '',
    storage: '',
    image: null,
    imageThumbnail: null,
    isFavorite: false
  }));

  await expect.poll(() => page.evaluate(async id => {
    const changes = await SyncPreparation.getPendingChanges();
    return changes.filter(change => change.entityId === id).map(change => change.channel).sort();
  }, recipeId)).toEqual(['content', 'favorite']);

  await secondPage.close();
});
