const { test, expect } = require('@playwright/test');

const APP_PATH = '/index.html?draft-library-e2e=1';

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

async function openCreateForm(page) {
  await page.getByRole('button', { name: 'Nuova ricetta', exact: true }).click();
  await expect(page.locator('#recipe-form')).toBeVisible();
  await expect(page).toHaveURL(/#create\/[^/]+$/);

  const match = new URL(page.url()).hash.match(/^#create\/([^/]+)$/);
  expect(match, `URL di creazione privo di draftId: ${page.url()}`).not.toBeNull();
  return {
    mode: 'create',
    recipeId: null,
    draftId: decodeURIComponent(match[1])
  };
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
          mode: record.mode,
          recipeId: record.recipeId,
          draftId: record.draftId,
          revision: record.revision,
          data: record.data
        }
      : null;
  }, target);
}

async function leaveFormKeepingDraft(page, destination = '#home') {
  await page.evaluate(hash => {
    location.hash = hash;
  }, destination);

  const confirmation = page.getByRole('dialog');
  await expect(
    confirmation.getByRole('heading', { name: 'Modifiche non salvate' })
  ).toBeVisible();
  await confirmation.locator('[data-action="modal-confirm"]').click();
  await expect(page).toHaveURL(new RegExp(destination.replace('#', '#') + '$'));
}

async function openDraftLibraryFromHome(page) {
  await page
    .locator('.draft-home-summary')
    .getByRole('button', { name: 'Gestisci tutte' })
    .click();
  await expect(page).toHaveURL(/#drafts$/);
  await expect(
    page.getByRole('heading', { name: 'Bozze locali', level: 1 })
  ).toBeVisible();
}

function draftPayload(name, recipeId, overrides = {}) {
  const recipe = {
    id: recipeId || null,
    name,
    category: 'dolci',
    description: 'Descrizione conservata nella bozza.',
    notes: 'Nota ancora da completare.',
    storage: 'Conservare in frigorifero.',
    ingredients: [
      { name: 'Farina', quantity: '180', unit: 'g', notes: '' }
    ],
    steps: [
      { text: 'Mescolare lentamente.', notes: '' }
    ],
    prepTime: 15,
    cookTime: 25,
    difficulty: 'media',
    servings: 4,
    image: null,
    imageThumbnail: null,
    isFavorite: false,
    contentVersion: 0,
    favoriteVersion: 0,
    imageVersion: 0,
    createdAt: Date.now() - 5_000,
    updatedAt: Date.now()
  };

  return {
    schemaVersion: 1,
    recipe: { ...recipe, ...(overrides.recipe || {}) },
    activeTab: overrides.activeTab || 'tab-info',
    baseContentVersion:
      overrides.baseContentVersion === undefined
        ? recipe.contentVersion
        : overrides.baseContentVersion,
    baseUpdatedAt:
      overrides.baseUpdatedAt === undefined
        ? recipe.updatedAt
        : overrides.baseUpdatedAt
  };
}

async function seedDraft(page, target, payload) {
  return page.evaluate(
    async ({ draftTarget, draftData }) => {
      const record = await DraftStore.save(draftTarget, draftData, {
        writerId: 'test-archivio',
        expectedRevision: null
      });
      return {
        revision: record.revision,
        data: record.data
      };
    },
    { draftTarget: target, draftData: payload }
  );
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

test('mostra una bozza autosalvata in Home e archivio e la riprende con tutti i campi', async ({
  page
}) => {
  await openHome(page);
  const target = await openCreateForm(page);

  await page.locator('#input-name').fill('Crostata ancora da finire');
  await page
    .locator('#input-description')
    .fill('Descrizione che deve ricomparire alla ripresa.');
  await page.getByRole('tab', { name: 'Ingredienti e preparazione' }).click();
  await page.locator('[data-field="ing-name"]').first().fill('Farina integrale');
  await page.locator('[data-field="ing-qty"]').first().fill('250');
  await page
    .locator('[data-field="step-text"]')
    .first()
    .fill('Impastare senza perdere i dati.');
  await waitForDraftSaved(page);

  await leaveFormKeepingDraft(page);
  const homeSummary = page.locator('.draft-home-summary');
  await expect(homeSummary).toBeVisible();
  await expect(homeSummary).toContainText('Hai una bozza locale');
  await expect(homeSummary).toContainText('Crostata ancora da finire');

  await openDraftLibraryFromHome(page);
  const card = page.locator('.draft-card').filter({
    has: page.getByRole('heading', {
      name: 'Crostata ancora da finire',
      level: 2
    })
  });
  await expect(card).toBeVisible();
  await expect(page.locator('.draft-library-count')).toHaveText(
    '1 bozza disponibile'
  );

  await card.getByRole('button', { name: 'Continua ricetta' }).click();
  await expect(page).toHaveURL(
    new RegExp(`#create/${encodeURIComponent(target.draftId)}$`)
  );
  await expect(page.locator('#input-name')).toHaveValue(
    'Crostata ancora da finire'
  );
  await expect(page.locator('#input-description')).toHaveValue(
    'Descrizione che deve ricomparire alla ripresa.'
  );
  await expect(page.locator('[data-field="ing-name"]').first()).toHaveValue(
    'Farina integrale'
  );
  await expect(page.locator('[data-field="ing-qty"]').first()).toHaveValue('250');
  await expect(page.locator('[data-field="step-text"]').first()).toHaveValue(
    'Impastare senza perdere i dati.'
  );
  await expect(
    page.getByRole('tab', { name: 'Ingredienti e preparazione' })
  ).toHaveAttribute('aria-selected', 'true');
});

test('elimina una bozza confermata e aggiorna archivio e indicatore Home', async ({
  page
}) => {
  await openHome(page);
  const target = await openCreateForm(page);
  await page.locator('#input-name').fill('Bozza da eliminare');
  await waitForDraftSaved(page);
  await leaveFormKeepingDraft(page);

  await expect(page.locator('.draft-home-summary')).toContainText(
    'Bozza da eliminare'
  );
  await openDraftLibraryFromHome(page);

  const card = page.locator('.draft-card').filter({
    has: page.getByRole('heading', { name: 'Bozza da eliminare', level: 2 })
  });
  await card.locator('[data-action="delete-draft"]').click();
  const confirmation = page.getByRole('dialog');
  await expect(
    confirmation.getByRole('heading', { name: 'Eliminare la bozza?' })
  ).toBeVisible();
  await confirmation.getByRole('button', { name: 'Elimina bozza' }).click();

  await expect(
    page.getByRole('heading', { name: 'Nessuna bozza da recuperare', level: 2 })
  ).toBeVisible();
  await expect.poll(() => readDraft(page, target)).toBeNull();

  await page.getByRole('button', { name: 'Torna alla home' }).click();
  await expect(page).toHaveURL(/#home$/);
  await expect(page.locator('.draft-home-summary')).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'Il tuo ricettario è vuoto' })
  ).toBeVisible();
});

test('una scheda con revisione obsoleta non cancella la bozza aggiornata altrove', async ({
  page,
  context
}) => {
  await openHome(page);
  const target = await openCreateForm(page);
  await page.locator('#input-name').fill('Versione iniziale in archivio');
  await waitForDraftSaved(page);
  const draftUrl = page.url();
  const initialRecord = await readDraft(page, target);

  await leaveFormKeepingDraft(page, '#drafts');
  await expect(
    page.getByRole('heading', { name: 'Bozze locali', level: 1 })
  ).toBeVisible();

  const otherPage = await context.newPage();
  await bootApp(otherPage, draftUrl);
  await expect(otherPage.locator('#input-name')).toHaveValue(
    'Versione iniziale in archivio'
  );
  await otherPage.locator('#input-name').fill('Versione recente altra scheda');
  await waitForDraftSaved(otherPage);
  const newerRecord = await readDraft(otherPage, target);
  expect(newerRecord.revision).toBeGreaterThan(initialRecord.revision);

  const staleCard = page.locator('.draft-card').filter({
    has: page.getByRole('heading', {
      name: 'Versione iniziale in archivio',
      level: 2
    })
  });
  await staleCard.locator('[data-action="delete-draft"]').click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Elimina bozza' })
    .click();

  await expect(page.locator('.toast--warning .toast-message')).toContainText(
    'è cambiata in un’altra scheda ed è stata mantenuta'
  );
  await expect(
    page.getByRole('heading', {
      name: 'Versione recente altra scheda',
      level: 2
    })
  ).toBeVisible();
  const preservedRecord = await readDraft(page, target);
  expect(preservedRecord.revision).toBe(newerRecord.revision);
  expect(preservedRecord.data.recipe.name).toBe(
    'Versione recente altra scheda'
  );
});

test('recupera una bozza di modifica orfana come nuova ricetta', async ({
  page
}) => {
  await openHome(page);
  const orphanTarget = {
    mode: 'edit',
    recipeId: 'ricetta-originale-rimossa',
    draftId: 'bozza-modifica-orfana'
  };
  await seedDraft(
    page,
    orphanTarget,
    draftPayload('Torta recuperata dalla bozza', orphanTarget.recipeId, {
      activeTab: 'tab-prep',
      baseContentVersion: 4,
      recipe: {
        contentVersion: 4,
        description: 'La ricetta originale non esiste più.',
        ingredients: [
          { name: 'Mandorle', quantity: '200', unit: 'g', notes: '' }
        ],
        steps: [{ text: 'Recuperare questa preparazione.', notes: '' }]
      }
    })
  );

  await goToDraftLibrary(page);
  const card = page.locator('.draft-card--orphaned');
  await expect(card).toContainText('Torta recuperata dalla bozza');
  await expect(card).toContainText('Da recuperare');
  await card.getByRole('button', { name: 'Recupera come nuova' }).click();

  await expect(page).toHaveURL(/#create\/recupero-[^/]+$/);
  await expect(page.locator('#input-name')).toHaveValue(
    'Torta recuperata dalla bozza'
  );
  await expect(page.locator('#input-description')).toHaveValue(
    'La ricetta originale non esiste più.'
  );
  await expect(page.locator('[data-field="ing-name"]').first()).toHaveValue(
    'Mandorle'
  );
  await expect(page.locator('[data-field="step-text"]').first()).toHaveValue(
    'Recuperare questa preparazione.'
  );
  await expect.poll(() => readDraft(page, orphanTarget)).toBeNull();

  const recoveredRecords = await page.evaluate(() => DraftStore.list({
    mode: 'create'
  }));
  expect(recoveredRecords).toHaveLength(1);
  expect(recoveredRecords[0].data.recipe.id).not.toBe(orphanTarget.recipeId);
  expect(recoveredRecords[0].data.recipe.name).toBe(
    'Torta recuperata dalla bozza'
  );
});

test('una bozza create già salvata apre il dettaglio e rimuove il residuo', async ({
  page
}) => {
  await openHome(page);
  const savedRecipeId = await page.evaluate(() => DB.addRecipe({
    name: 'Ricetta già completata',
    category: 'dolci',
    description: 'Questa ricetta è presente nel ricettario.',
    notes: '',
    storage: '',
    ingredients: [
      { name: 'Farina', quantity: '200', unit: 'g', notes: '' }
    ],
    steps: [{ text: 'Cuocere con cura.', notes: '' }],
    prepTime: 10,
    cookTime: 30,
    difficulty: 'facile',
    servings: 4,
    image: null,
    imageThumbnail: null,
    isFavorite: false
  }));
  const residualTarget = {
    mode: 'create',
    recipeId: null,
    draftId: 'bozza-create-gia-salvata'
  };
  const savedRecipe = await page.evaluate(
    recipeId => DB.getRecipe(recipeId),
    savedRecipeId
  );
  await seedDraft(
    page,
    residualTarget,
    {
      schemaVersion: 1,
      recipe: savedRecipe,
      activeTab: 'tab-info',
      baseContentVersion: savedRecipe.contentVersion,
      baseUpdatedAt: savedRecipe.updatedAt
    }
  );

  await goToDraftLibrary(page);
  const card = page.locator('.draft-card--already-saved');
  await expect(card).toContainText('Ricetta già completata');
  await card.getByRole('button', { name: 'Apri ricetta' }).click();

  await expect(page).toHaveURL(
    new RegExp(`#detail/${encodeURIComponent(savedRecipeId)}$`)
  );
  await expect(
    page.getByRole('heading', { name: 'Ricetta già completata', level: 1 })
  ).toBeVisible();
  await expect.poll(() => readDraft(page, residualTarget)).toBeNull();
  await expect(page.locator('.toast--success .toast-message')).toContainText(
    'Bozza residua rimossa'
  );
});

test('Home e archivio bozze non hanno overflow orizzontale a 320 e 820 pixel', async ({
  page
}) => {
  await openHome(page);
  await seedDraft(
    page,
    {
      mode: 'create',
      recipeId: null,
      draftId: 'bozza-layout-responsive'
    },
    draftPayload(
      'Una ricetta con un titolo volutamente lungo per verificare il layout responsivo',
      null
    )
  );

  for (const viewport of [
    { width: 320, height: 700 },
    { width: 820, height: 1180 }
  ]) {
    await page.setViewportSize(viewport);
    await goToDraftLibrary(page);
    await expect(page.locator('.draft-card')).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.getByRole('button', { name: 'Torna alla home' }).click();
    await expect(page.locator('.draft-home-summary')).toBeVisible();
    await expectNoHorizontalOverflow(page);
  }
});
