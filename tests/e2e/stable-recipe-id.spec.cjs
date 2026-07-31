const { test, expect } = require('@playwright/test');

const APP_PATH = '/index.html?stable-recipe-id-e2e=1';

async function bootApp(page, url = APP_PATH) {
  await page.addInitScript(() => {
    localStorage.setItem('sapori-warning-dismissed', 'true');
  });
  await page.goto(url);

  const warningButton = page.getByRole('button', { name: 'Ho capito' });
  if (await warningButton.isVisible().catch(() => false)) {
    await warningButton.click();
  }
}

async function openHome(page) {
  await bootApp(page);
  await expect(page.locator('.home-view h1')).toHaveText('Le mie ricette');
}

function createTarget(draftId) {
  return {
    mode: 'create',
    recipeId: null,
    draftId
  };
}

async function openNewRecipe(page) {
  await page.getByRole('button', { name: 'Nuova ricetta', exact: true }).click();
  await expect(page).toHaveURL(/#create\/[^/]+$/);
  await expect(page.locator('#recipe-form')).toBeVisible();

  const match = new URL(page.url()).hash.match(/^#create\/([^/]+)$/);
  expect(match, `URL di creazione privo di draftId: ${page.url()}`).not.toBeNull();
  return createTarget(decodeURIComponent(match[1]));
}

async function waitForDraftSaved(page) {
  await expect(page.locator('#draft-save-status')).toHaveAttribute(
    'data-status',
    'saved',
    { timeout: 10_000 }
  );
}

async function readDraft(page, target) {
  return page.evaluate(async draftTarget => {
    const record = await DraftStore.get(draftTarget);
    return record
      ? {
          revision: record.revision,
          data: record.data
        }
      : null;
  }, target);
}

async function recipeCount(page) {
  return page.evaluate(async () => (await DB.getAllRecipes()).length);
}

async function fillValidRecipe(page, name) {
  await page.locator('#input-name').fill(name);
  await page.locator('#input-description').fill(
    'Descrizione usata per verificare l’identificatore stabile.'
  );
  await page.getByRole('tab', { name: 'Ingredienti e preparazione' }).click();
  await page.locator('[data-field="ing-name"]').first().fill('Farina');
  await page.locator('[data-field="ing-qty"]').first().fill('200');
  await page.locator('[data-field="step-text"]').first().fill(
    'Mescolare con cura.'
  );
}

async function submitRecipe(page) {
  await page.getByRole('tab', { name: 'Dettagli di cottura' }).click();
  await page.locator('#recipe-form button[type="submit"]').click();
}

function draftPayload(recipeId, name) {
  const now = Date.now();
  return {
    version: 1,
    recipe: {
      id: recipeId,
      name,
      category: 'dolci',
      description: 'Descrizione conservata nella bozza.',
      notes: '',
      storage: '',
      ingredients: [
        { name: 'Farina', quantity: '200', unit: 'g', notes: '' }
      ],
      steps: [
        { text: 'Mescolare con cura.', notes: '' }
      ],
      prepTime: 10,
      cookTime: 25,
      difficulty: 'media',
      servings: 4,
      image: null,
      imageThumbnail: null,
      isFavorite: false,
      contentVersion: 0,
      favoriteVersion: 0,
      imageVersion: 0,
      createdAt: now,
      updatedAt: now
    },
    activeTab: 'tab-info',
    baseContentVersion: 0,
    baseUpdatedAt: null
  };
}

async function seedDraft(page, target, payload, writerId) {
  return page.evaluate(
    async ({ draftTarget, draftData, writer }) => {
      const record = await DraftStore.save(draftTarget, draftData, {
        writerId: writer,
        expectedRevision: null
      });
      return record.revision;
    },
    {
      draftTarget: target,
      draftData: payload,
      writer: writerId || 'test-id-stabile'
    }
  );
}

async function openDraftDirectly(page, target) {
  await page.goto(
    APP_PATH + '#create/' + encodeURIComponent(target.draftId)
  );
  await expect(page.locator('#recipe-form')).toBeVisible();
}

test('la creazione UI conserva lo stesso ID del modulo e della bozza', async ({
  page
}) => {
  await openHome(page);
  const target = await openNewRecipe(page);
  const formRecipeId = await page.locator('#input-id').inputValue();
  expect(formRecipeId).toMatch(/^[a-z0-9][a-z0-9_-]{0,127}$/i);

  await fillValidRecipe(page, 'Torta con ID stabile');
  await waitForDraftSaved(page);

  const savedDraft = await readDraft(page, target);
  expect(savedDraft).not.toBeNull();
  expect(savedDraft.data.recipe.id).toBe(formRecipeId);

  await submitRecipe(page);

  await expect(page).toHaveURL(/#home$/);
  await expect(
    page.getByText('Torta con ID stabile', { exact: true })
  ).toBeVisible();
  const persistedRecipe = await page.evaluate(id => DB.getRecipe(id), formRecipeId);
  expect(persistedRecipe).not.toBeNull();
  expect(persistedRecipe.id).toBe(formRecipeId);
  await expect.poll(() => readDraft(page, target)).toBeNull();
});

test('un residuo dopo errore di cleanup è riconosciuto e non duplica la ricetta', async ({
  page
}) => {
  await openHome(page);
  const target = await openNewRecipe(page);
  const formRecipeId = await page.locator('#input-id').inputValue();
  await fillValidRecipe(page, 'Crostata salvata con residuo');
  await waitForDraftSaved(page);

  await page.evaluate(() => {
    const originalRemove = DraftStore.remove;
    window.__stableIdRemoveCalls = 0;
    DraftStore.remove = function () {
      window.__stableIdRemoveCalls += 1;
      if (window.__stableIdRemoveCalls === 1) {
        const error = new Error('Errore di cleanup simulato');
        error.code = 'TEST_CLEANUP_FAILURE';
        return Promise.reject(error);
      }
      return originalRemove.apply(DraftStore, arguments);
    };
  });

  await submitRecipe(page);

  await expect(page).toHaveURL(/#home$/);
  expect(await recipeCount(page)).toBe(1);
  expect(await readDraft(page, target)).not.toBeNull();

  const summary = page.locator('.draft-home-summary');
  await expect(summary).toContainText('Crostata salvata con residuo');
  const openSavedRecipe = summary.getByRole('button', {
    name: /Apri ricetta Crostata salvata con residuo/
  });
  await expect(openSavedRecipe).toBeVisible();
  await openSavedRecipe.click();

  await expect(page).toHaveURL(
    new RegExp(`#detail/${encodeURIComponent(formRecipeId)}$`)
  );
  await expect(
    page.getByRole('heading', {
      name: 'Crostata salvata con residuo',
      level: 1
    })
  ).toBeVisible();
  expect(await recipeCount(page)).toBe(1);
  await expect.poll(() => readDraft(page, target)).toBeNull();
  expect(
    await page.evaluate(() => window.__stableIdRemoveCalls)
  ).toBeGreaterThanOrEqual(2);
});

test('l accesso diretto a una bozza già salvata apre il dettaglio e ripulisce il residuo', async ({
  page
}) => {
  await openHome(page);
  const recipeId = 'ricetta-diretta-gia-salvata';
  const target = createTarget('bozza-diretta-residua');

  await page.evaluate(
    ({ id, payload }) => DB.addRecipe(payload, { preserveId: true }),
    {
      id: recipeId,
      payload: {
        ...draftPayload(recipeId, 'Biscotti già salvati').recipe,
        id: recipeId
      }
    }
  );
  await seedDraft(
    page,
    target,
    draftPayload(recipeId, 'Biscotti già salvati'),
    'test-accesso-diretto'
  );
  expect(await readDraft(page, target)).not.toBeNull();

  await page.goto(
    APP_PATH + '#create/' + encodeURIComponent(target.draftId)
  );

  await expect(page).toHaveURL(
    new RegExp(`#detail/${encodeURIComponent(recipeId)}$`)
  );
  await expect(
    page.getByRole('heading', { name: 'Biscotti già salvati', level: 1 })
  ).toBeVisible();
  await expect.poll(() => readDraft(page, target)).toBeNull();
  expect(await recipeCount(page)).toBe(1);
});

test('due schede con lo stesso ID non si sovrascrivono e conservano la bozza perdente', async ({
  page,
  context
}) => {
  await openHome(page);
  const sharedRecipeId = 'ricetta-condivisa-tra-schede';
  const firstTarget = createTarget('bozza-scheda-vincente');
  const secondTarget = createTarget('bozza-scheda-concorrente');

  await seedDraft(
    page,
    firstTarget,
    draftPayload(sharedRecipeId, 'Versione iniziale prima scheda'),
    'test-prima-scheda'
  );
  await seedDraft(
    page,
    secondTarget,
    draftPayload(sharedRecipeId, 'Versione iniziale seconda scheda'),
    'test-seconda-scheda'
  );

  await openDraftDirectly(page, firstTarget);
  const secondPage = await context.newPage();
  await bootApp(
    secondPage,
    APP_PATH + '#create/' + encodeURIComponent(secondTarget.draftId)
  );
  await expect(secondPage.locator('#recipe-form')).toBeVisible();

  await page.locator('#input-name').fill('Versione salvata per prima');
  await secondPage.locator('#input-name').fill('Versione concorrente da preservare');
  await Promise.all([
    waitForDraftSaved(page),
    waitForDraftSaved(secondPage)
  ]);

  await submitRecipe(page);
  await expect(page).toHaveURL(/#home$/);
  await expect.poll(() => readDraft(page, firstTarget)).toBeNull();

  await submitRecipe(secondPage);

  await expect(secondPage).toHaveURL(
    new RegExp(`#create/${encodeURIComponent(secondTarget.draftId)}$`)
  );
  await expect(
    secondPage.locator('.toast--warning .toast-message')
  ).toContainText('già stata salvata in un’altra scheda');

  const storedRecipe = await secondPage.evaluate(id => DB.getRecipe(id), sharedRecipeId);
  expect(storedRecipe.name).toBe('Versione salvata per prima');
  expect(await recipeCount(secondPage)).toBe(1);

  const preservedDraft = await readDraft(secondPage, secondTarget);
  expect(preservedDraft).not.toBeNull();
  expect(preservedDraft.data.recipe.id).toBe(sharedRecipeId);
  expect(preservedDraft.data.recipe.name).toBe(
    'Versione concorrente da preservare'
  );

  await secondPage.close();
  const recoveredPage = await context.newPage();
  await bootApp(
    recoveredPage,
    APP_PATH + '#create/' + encodeURIComponent(secondTarget.draftId)
  );
  await expect(recoveredPage.locator('#recipe-form')).toBeVisible();
  await expect(
    recoveredPage.locator('.draft-recovery-banner')
  ).toContainText('Bozza recuperata come nuova copia');
  await expect(recoveredPage.locator('#input-name')).toHaveValue(
    'Versione concorrente da preservare'
  );

  const recoveredRecipeId = await recoveredPage.locator('#input-id').inputValue();
  expect(recoveredRecipeId).not.toBe(sharedRecipeId);

  await submitRecipe(recoveredPage);
  await expect(recoveredPage).toHaveURL(/#home$/);
  expect(await recipeCount(recoveredPage)).toBe(2);
  const firstStoredRecipe = await recoveredPage.evaluate(
    id => DB.getRecipe(id),
    sharedRecipeId
  );
  const recoveredStoredRecipe = await recoveredPage.evaluate(
    id => DB.getRecipe(id),
    recoveredRecipeId
  );
  expect(firstStoredRecipe.name).toBe('Versione salvata per prima');
  expect(recoveredStoredRecipe.name).toBe(
    'Versione concorrente da preservare'
  );
  await expect.poll(() => readDraft(recoveredPage, secondTarget)).toBeNull();
});
