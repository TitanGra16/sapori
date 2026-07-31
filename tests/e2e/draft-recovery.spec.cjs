const { test, expect } = require('@playwright/test');

const APP_PATH = '/index.html?draft-recovery-e2e=1';
const DESKTOP_PROJECT = 'chromium-desktop';
const SMALL_PHONE_PROJECT = 'chromium-small-phone';

async function openHome(page) {
  await page.addInitScript(() => {
    localStorage.setItem('sapori-warning-dismissed', 'true');
  });
  await page.goto(APP_PATH);

  const warningButton = page.getByRole('button', { name: 'Ho capito' });
  if (await warningButton.isVisible().catch(() => false)) {
    await warningButton.click();
  }

  await expect(page.locator('.home-view h1')).toHaveText('Le mie ricette');
}

function createTarget(draftId) {
  return {
    mode: 'create',
    recipeId: null,
    draftId
  };
}

function routeFor(target) {
  return target.mode === 'edit'
    ? '#edit/' + encodeURIComponent(target.recipeId) + '/' +
        encodeURIComponent(target.draftId)
    : '#create/' + encodeURIComponent(target.draftId);
}

function readablePayload(name) {
  const now = Date.now();
  return {
    version: 1,
    recipe: {
      id: null,
      name,
      category: 'dolci',
      description: 'Descrizione conservata nella bozza.',
      notes: '',
      storage: '',
      ingredients: [
        { name: 'Farina', quantity: '180', unit: 'g', notes: '' }
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

async function seedDraft(page, target, payload) {
  return page.evaluate(
    async ({ draftTarget, draftPayload }) => {
      const record = await DraftStore.save(draftTarget, draftPayload, {
        writerId: 'test-recupero',
        expectedRevision: null
      });
      return {
        revision: record.revision,
        data: record.data
      };
    },
    { draftTarget: target, draftPayload: payload }
  );
}

async function openDraft(page, target) {
  const expectedHash = routeFor(target);
  await page.evaluate(hash => {
    location.hash = hash;
  }, expectedHash);
  await expect.poll(() => page.evaluate(() => location.hash)).toBe(expectedHash);
  await expect(page.locator('#recipe-form')).toBeVisible();
}

async function readDraft(page, target) {
  return page.evaluate(async draftTarget => {
    return DraftStore.get(draftTarget);
  }, target);
}

async function seedUnreadableDraft(page, target) {
  return page.evaluate(async draftTarget => {
    const database = await DraftStore.init();
    const now = Date.now();
    const key = draftTarget.mode === 'edit'
      ? 'edit:' + draftTarget.recipeId + ':' + draftTarget.draftId
      : 'create:' + draftTarget.draftId;
    const rawRecord = {
      key,
      mode: draftTarget.mode,
      recipeId: draftTarget.recipeId || null,
      draftId: draftTarget.draftId,
      data: 'contenuto-totalmente-illeggibile',
      writerId: 'test-corruzione',
      revision: 1,
      createdAt: now,
      updatedAt: now,
      expiresAt: now + DraftStore.DRAFT_TTL_MS
    };

    await new Promise((resolve, reject) => {
      const transaction = database.transaction(DraftStore.STORE_NAME, 'readwrite');
      transaction.objectStore(DraftStore.STORE_NAME).put(rawRecord);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(
        transaction.error || new Error('Impossibile inserire il record corrotto')
      );
      transaction.onabort = transaction.onerror;
    });
    return DraftStore.get(draftTarget);
  }, target);
}

async function failFirstDraftRead(page, target) {
  await page.evaluate(draftTarget => {
    const originalGet = DraftStore.get.bind(DraftStore);
    const sameTarget = candidate => {
      return candidate &&
        candidate.mode === draftTarget.mode &&
        (candidate.recipeId || null) === (draftTarget.recipeId || null) &&
        candidate.draftId === draftTarget.draftId;
    };

    window.__draftRecoveryGetAttempts = 0;
    DraftStore.get = async candidate => {
      if (sameTarget(candidate)) {
        window.__draftRecoveryGetAttempts += 1;
        if (window.__draftRecoveryGetAttempts === 1) {
          const error = new Error('Errore temporaneo simulato durante la lettura');
          error.code = 'DRAFT_STORE_ERROR';
          throw error;
        }
      }
      return originalGet(candidate);
    };
  }, target);
}

async function expectNoHorizontalOverflow(page) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: Math.max(
      document.documentElement.scrollWidth,
      document.body ? document.body.scrollWidth : 0
    )
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport + 1);
}

test.describe('recupero robusto delle bozze su desktop', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(
      testInfo.project.name !== DESKTOP_PROJECT,
      'I casi completi vengono eseguiti una volta nel progetto desktop.'
    );
  });

  test('normalizza un payload parzialmente corrotto e mantiene il form utilizzabile', async ({
    page
  }) => {
    await openHome(page);
    const target = createTarget('bozza-parzialmente-corrotta');
    const longName = 'N'.repeat(180);
    const longDescription = 'D'.repeat(2400);
    const payload = readablePayload(longName);
    payload.recipe.description = longDescription;
    payload.recipe.category = '../../categoria-non-valida';
    payload.recipe.prepTime = { valore: 15 };
    payload.recipe.servings = 'numero-non-valido';
    payload.recipe.image = 'javascript:contenuto-non-valido';
    payload.recipe.ingredients = [
      null,
      'ingrediente-non-oggetto',
      {
        name: 42,
        quantity: false,
        unit: { valore: 'g' },
        notes: 7
      }
    ];
    payload.recipe.steps = [
      null,
      false,
      { text: 55, notes: { valore: 'nota' } },
      'Passaggio ancora leggibile'
    ];
    payload.activeTab = 'scheda-sconosciuta';

    await seedDraft(page, target, payload);
    await openDraft(page, target);

    await expect(page.getByText('Bozza recuperata', { exact: true })).toBeVisible();
    await expect(page.locator('#input-name')).toHaveValue('N'.repeat(120));
    await expect(page.locator('#input-description')).toHaveValue('D'.repeat(2000));
    await expect(page.locator('#input-category')).toHaveValue('altro');
    await expect(page.locator('#input-preptime')).toHaveValue('');
    await expect(page.locator('#input-preptime')).toHaveAttribute('placeholder', '0');
    await expect(page.locator('#input-servings')).toHaveValue('4');
    await expect(page.locator('#input-image-data')).toHaveValue('');
    await expect(
      page.getByRole('tab', { name: 'Informazioni generali' })
    ).toHaveAttribute('aria-selected', 'true');

    await page.getByRole('tab', { name: 'Ingredienti e preparazione' }).click();
    const ingredientNames = page.locator('[data-field="ing-name"]');
    const ingredientQuantities = page.locator('[data-field="ing-qty"]');
    const ingredientNotes = page.locator('[data-field="ing-notes"]');
    const ingredientUnits = page.locator('[data-field="ing-unit"]');
    const stepTexts = page.locator('[data-field="step-text"]');
    const stepNotes = page.locator('[data-field="step-notes"]');

    await expect(ingredientNames).toHaveCount(3);
    await expect(ingredientNames.nth(0)).toHaveValue('');
    await expect(ingredientNames.nth(1)).toHaveValue('');
    await expect(ingredientNames.nth(2)).toHaveValue('42');
    await expect(ingredientQuantities.nth(2)).toHaveValue('false');
    await expect(ingredientUnits.nth(2)).toHaveValue('');
    await expect(ingredientNotes.nth(2)).toHaveValue('7');

    await expect(stepTexts).toHaveCount(4);
    await expect(stepTexts.nth(0)).toHaveValue('');
    await expect(stepTexts.nth(1)).toHaveValue('');
    await expect(stepTexts.nth(2)).toHaveValue('55');
    await expect(stepNotes.nth(2)).toHaveValue('');
    await expect(stepTexts.nth(3)).toHaveValue('Passaggio ancora leggibile');

    await ingredientNames.nth(0).fill('Farina recuperata');
    await stepTexts.nth(0).fill('Mescolare la bozza normalizzata.');
    await expect(page.locator('#draft-save-status')).toHaveAttribute(
      'data-status',
      'saved',
      { timeout: 10_000 }
    );

    const savedRecord = await readDraft(page, target);
    expect(savedRecord).not.toBeNull();
    expect(savedRecord.data.recipe.name).toBe('N'.repeat(120));
    expect(savedRecord.data.recipe.description).toBe('D'.repeat(2000));
    expect(savedRecord.data.recipe.ingredients[0].name).toBe('Farina recuperata');
    expect(savedRecord.data.recipe.steps[0].text).toBe(
      'Mescolare la bozza normalizzata.'
    );
    await expect(page.locator('#recipe-form')).toBeEnabled();
  });

  test('preserva una bozza illeggibile e la mostra in archivio senza azione di apertura', async ({
    page
  }) => {
    await openHome(page);
    const target = createTarget('bozza-totalmente-illeggibile');
    const seeded = await seedUnreadableDraft(page, target);
    await openDraft(page, target);

    const recoveryAlert = page.locator(
      '.draft-recovery-banner--error[role="alert"]'
    );
    await expect(recoveryAlert).toBeVisible();
    await expect(recoveryAlert).toContainText('Bozza non recuperata');
    await expect(recoveryAlert).toContainText(/contenuto salvato non .* leggibile/i);
    await expect(
      recoveryAlert.getByRole('button', { name: 'Riprova recupero' })
    ).toBeVisible();
    await expect(
      recoveryAlert.getByRole('button', { name: 'Elimina bozza illeggibile' })
    ).toBeVisible();
    await expect(
      recoveryAlert.getByRole('button', { name: 'Continua in una copia pulita' })
    ).toBeVisible();
    await expect(page.locator('#draft-save-status')).toHaveAttribute(
      'data-status',
      'error'
    );
    await expect(page.locator('#draft-save-status')).toHaveAttribute(
      'role',
      'alert'
    );
    await expect(page.locator('#recipe-form')).toHaveAttribute('inert', '');

    const preservedBeforeArchive = await readDraft(page, target);
    expect(preservedBeforeArchive).not.toBeNull();
    expect(preservedBeforeArchive.revision).toBe(seeded.revision);
    expect(preservedBeforeArchive.data).toBe(
      'contenuto-totalmente-illeggibile'
    );

    await page.evaluate(() => {
      location.hash = '#drafts';
    });
    await expect(page).toHaveURL(/#drafts$/);
    await expect(
      page.getByRole('heading', { name: 'Bozze locali', level: 1 })
    ).toBeVisible();

    const unreadableCard = page.locator('.draft-card--unreadable');
    await expect(unreadableCard).toBeVisible();
    await expect(
      unreadableCard.getByRole('heading', {
        name: 'Bozza non leggibile',
        level: 2
      })
    ).toBeVisible();
    await expect(unreadableCard).toContainText('Da controllare');
    await expect(unreadableCard.locator('[data-action="resume-draft"]')).toHaveCount(0);
    await expect(
      unreadableCard.getByRole('button', {
        name: 'Elimina la bozza Bozza non leggibile'
      })
    ).toBeVisible();

    const preservedAfterArchive = await readDraft(page, target);
    expect(preservedAfterArchive).not.toBeNull();
    expect(preservedAfterArchive.revision).toBe(seeded.revision);
  });

  test('Elimina bozza illeggibile rimuove soltanto il record confermato', async ({
    page
  }) => {
    await openHome(page);
    const target = createTarget('bozza-illeggibile-da-eliminare');
    await seedUnreadableDraft(page, target);
    await openDraft(page, target);

    await page
      .getByRole('button', { name: 'Elimina bozza illeggibile' })
      .click();
    const confirmation = page.getByRole('dialog');
    await expect(
      confirmation.getByRole('heading', { name: 'Scartare la bozza?' })
    ).toBeVisible();
    await confirmation.getByRole('button', { name: 'Scarta bozza' }).click();

    await expect(page).toHaveURL(/#create\/[^/]+$/);
    await expect(page.locator('#recipe-form')).toBeVisible();
    await expect.poll(() => readDraft(page, target)).toBeNull();
    await expect(page.locator('.draft-recovery-banner--error')).toHaveCount(0);
  });

  test('Riprova recupero supera un errore transitorio di DraftStore.get', async ({
    page
  }) => {
    await openHome(page);
    const target = createTarget('bozza-con-errore-transitorio');
    await seedDraft(
      page,
      target,
      readablePayload('Ricetta recuperata dopo il retry')
    );
    await failFirstDraftRead(page, target);
    await openDraft(page, target);

    const recoveryAlert = page.locator(
      '.draft-recovery-banner--error[role="alert"]'
    );
    await expect(recoveryAlert).toBeVisible();
    await expect(recoveryAlert).toContainText(/archivio locale non ha risposto/i);
    await expect(
      recoveryAlert.getByRole('button', { name: 'Riprova recupero' })
    ).toBeVisible();
    await expect(
      recoveryAlert.getByRole('button', { name: 'Elimina bozza illeggibile' })
    ).toHaveCount(0);
    await expect(
      recoveryAlert.getByRole('button', { name: 'Continua senza recupero' })
    ).toBeVisible();
    await expect(page.locator('#recipe-form')).toHaveAttribute('inert', '');
    await expect(page.locator('#draft-save-status')).toHaveAttribute(
      'data-status',
      'error'
    );
    expect(
      await page.evaluate(() => window.__draftRecoveryGetAttempts)
    ).toBe(1);

    await recoveryAlert
      .getByRole('button', { name: 'Riprova recupero' })
      .click();

    await expect(page.getByText('Bozza recuperata', { exact: true })).toBeVisible();
    await expect(page.locator('#input-name')).toHaveValue(
      'Ricetta recuperata dopo il retry'
    );
    await expect(page.locator('#draft-save-status')).toHaveAttribute(
      'data-status',
      'recovered'
    );
    await expect(page.locator('#recipe-form')).not.toHaveAttribute('inert', '');
    expect(
      await page.evaluate(() => window.__draftRecoveryGetAttempts)
    ).toBe(2);
    expect(await readDraft(page, target)).not.toBeNull();
  });
});

test.describe('alert di recupero a 320 px', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(
      testInfo.project.name !== SMALL_PHONE_PROJECT,
      'Lo smoke responsivo viene eseguito soltanto nel progetto da 320 px.'
    );
  });

  test('mostra l’errore senza overflow orizzontale e con azioni utilizzabili', async ({
    page
  }) => {
    await openHome(page);
    expect(await page.evaluate(() => window.innerWidth)).toBe(320);

    const target = createTarget('bozza-illeggibile-layout-320');
    await seedUnreadableDraft(page, target);
    await openDraft(page, target);

    const recoveryAlert = page.locator(
      '.draft-recovery-banner--error[role="alert"]'
    );
    await expect(recoveryAlert).toBeVisible();
    await expect(page.locator('#draft-save-status')).toHaveAttribute(
      'data-status',
      'error'
    );
    await expect(
      recoveryAlert.getByRole('button', { name: 'Riprova recupero' })
    ).toBeVisible();
    await expect(
      recoveryAlert.getByRole('button', { name: 'Elimina bozza illeggibile' })
    ).toBeVisible();
    await expect(page.locator('#recipe-form')).toHaveAttribute('inert', '');
    await expectNoHorizontalOverflow(page);

    const alertBox = await recoveryAlert.boundingBox();
    expect(alertBox).not.toBeNull();
    expect(alertBox.x).toBeGreaterThanOrEqual(-1);
    expect(alertBox.x + alertBox.width).toBeLessThanOrEqual(321);
  });
});
