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

async function listCreateDrafts(page) {
  return page.evaluate(async () => {
    const records = await DraftStore.list({ mode: 'create' });
    return records.map(record => ({
      draftId: record.draftId,
      revision: record.revision,
      data: record.data
    }));
  });
}

async function waitForDraftStatus(page, status) {
  await expect(page.locator('#draft-save-status')).toHaveAttribute(
    'data-status',
    status,
    { timeout: 10_000 }
  );
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

async function goToDraftLibrary(page) {
  await page.evaluate(() => {
    location.hash = '#drafts';
  });
  await expect(page).toHaveURL(/#drafts$/);
  await expect(
    page.getByRole('heading', { name: 'Bozze locali', level: 1 })
  ).toBeVisible();
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

test('due schede con lo stesso ID non si sovrascrivono e trasformano la bozza perdente in copia', async ({
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

  await expect(secondPage).toHaveURL(/#create\/copia-[^/]+$/);
  await expect(
    secondPage.locator('.toast--warning .toast-message')
  ).toContainText('al sicuro come nuova copia');

  const storedRecipe = await secondPage.evaluate(id => DB.getRecipe(id), sharedRecipeId);
  expect(storedRecipe.name).toBe('Versione salvata per prima');
  expect(await recipeCount(secondPage)).toBe(1);

  await expect.poll(() => readDraft(secondPage, secondTarget)).toBeNull();
  const copyMatch = new URL(secondPage.url()).hash.match(/^#create\/([^/]+)$/);
  expect(copyMatch).not.toBeNull();
  const copyTarget = createTarget(decodeURIComponent(copyMatch[1]));
  const preservedDraft = await readDraft(secondPage, copyTarget);
  expect(preservedDraft).not.toBeNull();
  expect(preservedDraft.data.recipe.id).not.toBe(sharedRecipeId);
  expect(preservedDraft.data.recipe.name).toBe(
    'Versione concorrente da preservare'
  );

  await secondPage.close();
  const recoveredPage = await context.newPage();
  await bootApp(
    recoveredPage,
    APP_PATH + '#create/' + encodeURIComponent(copyTarget.draftId)
  );
  await expect(recoveredPage.locator('#recipe-form')).toBeVisible();
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
  await expect.poll(() => readDraft(recoveredPage, copyTarget)).toBeNull();
});

test('la stessa URL aperta prima del primo autosalvataggio condivide l ID e non crea duplicati', async ({
  page,
  context
}) => {
  await openHome(page);
  const target = await openNewRecipe(page);
  const sharedUrl = page.url();
  const firstRecipeId = await page.locator('#input-id').inputValue();
  expect(await readDraft(page, target)).toBeNull();

  const secondPage = await context.newPage();
  await bootApp(secondPage, sharedUrl);
  await expect(secondPage.locator('#recipe-form')).toBeVisible();
  const secondRecipeId = await secondPage.locator('#input-id').inputValue();

  await fillValidRecipe(page, 'Ricetta dalla stessa URL');
  await waitForDraftSaved(page);
  await fillValidRecipe(secondPage, 'Ricetta dalla stessa URL');
  await waitForDraftStatus(secondPage, 'conflict');

  await submitRecipe(page);
  await expect(page).toHaveURL(/#home$/);
  await submitRecipe(secondPage);

  expect(secondRecipeId).toBe(firstRecipeId);
  await expect.poll(() => recipeCount(secondPage)).toBe(1);
  const recipes = await secondPage.evaluate(async () => {
    return (await DB.getAllRecipes()).map(recipe => ({
      id: recipe.id,
      name: recipe.name
    }));
  });
  expect(recipes).toEqual([
    {
      id: firstRecipeId,
      name: 'Ricetta dalla stessa URL'
    }
  ]);
});

test('la versione divergente della stessa bozza diventa una copia durevole e salvabile', async ({
  page,
  context
}) => {
  await openHome(page);
  const originalTarget = await openNewRecipe(page);
  await fillValidRecipe(page, 'Versione condivisa iniziale');
  await waitForDraftSaved(page);
  const sharedUrl = page.url();
  const sharedRecipeId = await page.locator('#input-id').inputValue();

  const losingPage = await context.newPage();
  await bootApp(losingPage, sharedUrl);
  await expect(losingPage.locator('#recipe-form')).toBeVisible();

  await page.getByRole('tab', { name: 'Informazioni generali' }).click();
  await page.locator('#input-name').fill('Versione salvata per prima');
  await waitForDraftSaved(page);

  await losingPage.getByRole('tab', { name: 'Informazioni generali' }).click();
  await losingPage
    .locator('#input-name')
    .fill('Versione divergente da recuperare');
  await waitForDraftStatus(losingPage, 'conflict');

  await submitRecipe(page);
  await expect(page).toHaveURL(/#home$/);
  await submitRecipe(losingPage);

  let recoveredDraft = null;
  await expect.poll(async () => {
    const drafts = await listCreateDrafts(losingPage);
    recoveredDraft = drafts.find(record => (
      record.data &&
      record.data.recipe &&
      record.data.recipe.name === 'Versione divergente da recuperare'
    )) || null;
    return Boolean(recoveredDraft);
  }).toBe(true);
  expect(recoveredDraft.draftId).not.toBe(originalTarget.draftId);

  await losingPage.close();
  const recoveredPage = await context.newPage();
  await bootApp(
    recoveredPage,
    APP_PATH + '#create/' + encodeURIComponent(recoveredDraft.draftId)
  );
  await expect(recoveredPage.locator('#recipe-form')).toBeVisible();
  await expect(recoveredPage.locator('#input-name')).toHaveValue(
    'Versione divergente da recuperare'
  );
  const recoveredRecipeId = await recoveredPage.locator('#input-id').inputValue();
  expect(recoveredRecipeId).not.toBe(sharedRecipeId);

  await submitRecipe(recoveredPage);
  await expect(recoveredPage).toHaveURL(/#home$/);
  await expect.poll(() => recipeCount(recoveredPage)).toBe(2);
  const recipesById = await recoveredPage.evaluate(async () => {
    return Object.fromEntries(
      (await DB.getAllRecipes()).map(recipe => [recipe.id, recipe.name])
    );
  });
  expect(recipesById[sharedRecipeId]).toBe('Versione salvata per prima');
  expect(recipesById[recoveredRecipeId]).toBe(
    'Versione divergente da recuperare'
  );
  await expect.poll(
    () => readDraft(recoveredPage, createTarget(recoveredDraft.draftId))
  ).toBeNull();
});

test('una differenza di sole maiuscole resta una copia e non viene eliminata come residuo', async ({
  page
}) => {
  await openHome(page);
  const savedRecipeId = 'ricetta-con-maiuscole';
  const target = createTarget('bozza-con-minuscole');
  const savedPayload = draftPayload(savedRecipeId, 'Torta Classica');
  const divergentPayload = draftPayload(savedRecipeId, 'torta classica');

  await page.evaluate(
    payload => DB.addRecipe(payload.recipe, { preserveId: true }),
    savedPayload
  );
  await seedDraft(
    page,
    target,
    divergentPayload,
    'test-differenza-maiuscole'
  );

  await page.goto(
    APP_PATH + '#create/' + encodeURIComponent(target.draftId)
  );

  await expect(page.locator('#recipe-form')).toBeVisible();
  await expect(page).toHaveURL(
    new RegExp(`#create/${encodeURIComponent(target.draftId)}$`)
  );
  await expect(page.locator('#input-name')).toHaveValue('torta classica');
  expect(await readDraft(page, target)).not.toBeNull();
  const copyRecipeId = await page.locator('#input-id').inputValue();
  expect(copyRecipeId).not.toBe(savedRecipeId);

  await submitRecipe(page);
  await expect(page).toHaveURL(/#home$/);
  await expect.poll(() => recipeCount(page)).toBe(2);
  const names = await page.evaluate(async () => {
    return (await DB.getAllRecipes()).map(recipe => recipe.name).sort();
  });
  expect(names).toEqual(['Torta Classica', 'torta classica'].sort());
});

test('un residuo con foto identica apre la ricetta salvata e viene rimosso', async ({
  page
}) => {
  await openHome(page);
  const recipeId = 'ricetta-foto-identica';
  const target = createTarget('bozza-foto-identica');
  const fullImage = 'data:image/jpeg;base64,Rk9UT19JREVOVElDQQ==';
  const thumbnail = 'data:image/jpeg;base64,TUlOSV9JREVOVElDQQ==';
  const payload = draftPayload(recipeId, 'Ricetta con foto identica');
  payload.recipe.image = fullImage;
  payload.recipe.imageThumbnail = thumbnail;

  await page.evaluate(
    recipe => DB.addRecipe(recipe, { preserveId: true }),
    payload.recipe
  );
  await seedDraft(page, target, payload, 'test-foto-identica');
  await goToDraftLibrary(page);

  const card = page.locator('.draft-card').filter({
    has: page.getByRole('heading', {
      name: 'Ricetta con foto identica',
      level: 2
    })
  });
  await expect(card).toBeVisible();
  await card.locator('[data-action="resume-draft"]').click();

  await expect(page).toHaveURL(
    new RegExp(`#detail/${encodeURIComponent(recipeId)}$`)
  );
  await expect.poll(() => readDraft(page, target)).toBeNull();
  expect(await recipeCount(page)).toBe(1);
  const storedImage = await page.evaluate(id => (
    DB.getRecipe(id).then(recipe => recipe.image)
  ), recipeId);
  expect(storedImage).toBe(fullImage);
});

test('un residuo con foto diversa viene salvato come nuova copia senza sovrascrivere l originale', async ({
  page
}) => {
  await openHome(page);
  const savedRecipeId = 'ricetta-foto-originale';
  const target = createTarget('bozza-foto-diversa');
  const originalImage = 'data:image/jpeg;base64,Rk9UT19PUklHSU5BTEU=';
  const draftImage = 'data:image/jpeg;base64,Rk9UT19ESVZFUlNB';
  const savedPayload = draftPayload(
    savedRecipeId,
    'Ricetta fotografica salvata'
  );
  savedPayload.recipe.image = originalImage;
  savedPayload.recipe.imageThumbnail =
    'data:image/jpeg;base64,TUlOSV9PUklHSU5BTEU=';
  const divergentPayload = draftPayload(
    savedRecipeId,
    'Ricetta fotografica salvata'
  );
  divergentPayload.recipe.image = draftImage;
  divergentPayload.recipe.imageThumbnail =
    'data:image/jpeg;base64,TUlOSV9ESVZFUlNB';

  await page.evaluate(
    recipe => DB.addRecipe(recipe, { preserveId: true }),
    savedPayload.recipe
  );
  await seedDraft(
    page,
    target,
    divergentPayload,
    'test-foto-diversa'
  );
  await goToDraftLibrary(page);

  const card = page.locator('.draft-card').filter({
    has: page.getByRole('heading', {
      name: 'Ricetta fotografica salvata',
      level: 2
    })
  });
  await expect(card).toHaveClass(/draft-card--photo-check/);
  await card.locator('[data-action="resume-draft"]').click();

  await expect(page.locator('#recipe-form')).toBeVisible();
  const copyRecipeId = await page.locator('#input-id').inputValue();
  expect(copyRecipeId).not.toBe(savedRecipeId);
  await submitRecipe(page);
  await expect(page).toHaveURL(/#home$/);
  await expect.poll(() => recipeCount(page)).toBe(2);

  const images = await page.evaluate(async ({ originalId, copyId }) => {
    const [original, copy] = await Promise.all([
      DB.getRecipe(originalId),
      DB.getRecipe(copyId)
    ]);
    return {
      original: original && original.image,
      copy: copy && copy.image
    };
  }, {
    originalId: savedRecipeId,
    copyId: copyRecipeId
  });
  expect(images.original).toBe(originalImage);
  expect(images.copy).toBe(draftImage);
  await expect.poll(() => readDraft(page, target)).toBeNull();
});
