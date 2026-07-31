const { test, expect } = require('@playwright/test');

async function openApp(page, options = {}) {
  await page.addInitScript(({ mockStorage }) => {
    localStorage.setItem('sapori-warning-dismissed', 'true');

    if (!mockStorage) return;

    window.__storageTestState = {
      estimateCalls: 0,
      persistedCalls: 0,
      persistCalls: 0,
      persisted: false
    };

    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: {
        async estimate() {
          window.__storageTestState.estimateCalls += 1;
          return {
            usage: 2 * 1024 * 1024,
            quota: 20 * 1024 * 1024
          };
        },
        async persisted() {
          window.__storageTestState.persistedCalls += 1;
          return window.__storageTestState.persisted;
        },
        async persist() {
          window.__storageTestState.persistCalls += 1;
          window.__storageTestState.persisted = true;
          return true;
        }
      }
    });
  }, { mockStorage: options.mockStorage === true });

  await page.goto('/index.html?drafts-data-e2e=1');

  const warningButton = page.getByRole('button', { name: 'Ho capito' });
  if (await warningButton.isVisible().catch(() => false)) {
    await warningButton.click();
  }

  await expect(page.locator('.home-view h1')).toHaveText('Le mie ricette');
}

async function openCreateForm(page) {
  await page.getByRole('button', { name: 'Nuova ricetta', exact: true }).click();
  await expect(page).toHaveURL(/#create\/[^/]+$/);
  await expect(page.locator('#recipe-form')).toBeVisible();
  return getCreateDraftId(page);
}

function getCreateDraftId(page) {
  const match = new URL(page.url()).hash.match(/^#create\/([^/]+)$/);
  expect(match, `URL di creazione privo di draftId: ${page.url()}`).not.toBeNull();
  return decodeURIComponent(match[1]);
}

async function waitForDraftSaved(page) {
  await expect(page.locator('#draft-save-status')).toHaveAttribute(
    'data-status',
    'saved',
    { timeout: 10_000 }
  );
}

async function reloadAcceptingBeforeUnload(page) {
  const acceptBeforeUnload = dialog => dialog.accept().catch(() => {});
  page.on('dialog', acceptBeforeUnload);
  try {
    await page.reload({ waitUntil: 'domcontentloaded' });
  } finally {
    page.off('dialog', acceptBeforeUnload);
  }
}

async function readCreateDraft(page, draftId) {
  return page.evaluate(async id => {
    const record = await DraftStore.get({
      mode: 'create',
      draftId: id
    });
    return record
      ? {
          draftId: record.draftId,
          revision: record.revision,
          data: record.data
        }
      : null;
  }, draftId);
}

async function fillValidRecipe(page, name) {
  await page.locator('#input-name').fill(name);
  await page.locator('#input-description').fill('Descrizione salvata nella bozza.');
  await page.getByRole('tab', { name: 'Ingredienti e preparazione' }).click();
  await page.locator('[data-field="ing-name"]').first().fill('Farina');
  await page.locator('[data-field="ing-qty"]').first().fill('100');
  await page.locator('[data-field="step-text"]').first().fill('Mescolare con cura.');
}

async function confirmOpenModal(page) {
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('[data-action="modal-confirm"]').click();
}

test('recupera dopo il reload campi e scheda attiva di una nuova ricetta', async ({ page }) => {
  await openApp(page);
  const draftId = await openCreateForm(page);

  await page.locator('#input-name').fill('Torta in lavorazione');
  await page.locator('#input-description').fill('Una descrizione che non deve andare persa.');
  await page.getByRole('tab', { name: 'Ingredienti e preparazione' }).click();
  await page.locator('[data-field="ing-name"]').first().fill('Farina integrale');
  await page.locator('[data-field="ing-qty"]').first().fill('250');
  await page.locator('[data-field="step-text"]').first().fill('Impastare lentamente.');
  await waitForDraftSaved(page);

  const savedRecord = await readCreateDraft(page, draftId);
  expect(savedRecord).not.toBeNull();
  expect(savedRecord.data.activeTab).toBe('tab-prep');
  expect(savedRecord.data.recipe.name).toBe('Torta in lavorazione');

  await reloadAcceptingBeforeUnload(page);

  await expect(page.getByText('Bozza recuperata', { exact: true })).toBeVisible();
  await expect(page.locator('#input-name')).toHaveValue('Torta in lavorazione');
  await expect(page.locator('#input-description')).toHaveValue(
    'Una descrizione che non deve andare persa.'
  );
  await expect(page.locator('[data-field="ing-name"]').first()).toHaveValue(
    'Farina integrale'
  );
  await expect(page.locator('[data-field="ing-qty"]').first()).toHaveValue('250');
  await expect(page.locator('[data-field="step-text"]').first()).toHaveValue(
    'Impastare lentamente.'
  );
  await expect(
    page.getByRole('tab', { name: 'Ingredienti e preparazione' })
  ).toHaveAttribute('aria-selected', 'true');
  expect(getCreateDraftId(page)).toBe(draftId);
});

test('mantiene separate le bozze create in due schede', async ({ page, context }) => {
  await openApp(page);
  const secondPage = await context.newPage();
  await openApp(secondPage);

  const firstDraftId = await openCreateForm(page);
  const secondDraftId = await openCreateForm(secondPage);
  expect(firstDraftId).not.toBe(secondDraftId);

  await page.locator('#input-name').fill('Bozza della prima scheda');
  await secondPage.locator('#input-name').fill('Bozza della seconda scheda');
  await Promise.all([
    waitForDraftSaved(page),
    waitForDraftSaved(secondPage)
  ]);

  const [firstRecord, secondRecord] = await Promise.all([
    readCreateDraft(page, firstDraftId),
    readCreateDraft(secondPage, secondDraftId)
  ]);
  expect(firstRecord.data.recipe.name).toBe('Bozza della prima scheda');
  expect(secondRecord.data.recipe.name).toBe('Bozza della seconda scheda');

  await Promise.all([
    reloadAcceptingBeforeUnload(page),
    reloadAcceptingBeforeUnload(secondPage)
  ]);

  await expect(page.locator('#input-name')).toHaveValue('Bozza della prima scheda');
  await expect(secondPage.locator('#input-name')).toHaveValue(
    'Bozza della seconda scheda'
  );
  expect(getCreateDraftId(page)).toBe(firstDraftId);
  expect(getCreateDraftId(secondPage)).toBe(secondDraftId);
});

test('elimina la bozza dopo il salvataggio della ricetta', async ({ page }) => {
  await openApp(page);
  const draftId = await openCreateForm(page);
  await fillValidRecipe(page, 'Ricetta completata');
  await waitForDraftSaved(page);

  await page.getByRole('tab', { name: 'Dettagli di cottura' }).click();
  await page.locator('#recipe-form button[type="submit"]').click();

  await expect(page).toHaveURL(/#home$/);
  await expect(page.getByText('Ricetta completata', { exact: true })).toBeVisible();
  await expect.poll(() => readCreateDraft(page, draftId)).toBeNull();
});

test('Annulla confermato scarta la bozza locale', async ({ page }) => {
  await openApp(page);
  const draftId = await openCreateForm(page);
  await page.locator('#input-name').fill('Bozza da annullare');
  await waitForDraftSaved(page);

  await page.getByRole('button', { name: 'Annulla e torna indietro' }).click();
  await confirmOpenModal(page);

  await expect(page).toHaveURL(/#home$/);
  await expect.poll(() => readCreateDraft(page, draftId)).toBeNull();
});

test('Scarta bozza rimuove il record recuperato e apre un modulo pulito', async ({ page }) => {
  await openApp(page);
  const discardedDraftId = await openCreateForm(page);
  await page.locator('#input-name').fill('Bozza recuperata da scartare');
  await waitForDraftSaved(page);
  await reloadAcceptingBeforeUnload(page);

  await page.getByRole('button', { name: 'Scarta bozza', exact: true }).click();
  await confirmOpenModal(page);

  await expect(page.locator('#recipe-form')).toBeVisible();
  await expect(page.locator('#input-name')).toHaveValue('');
  expect(getCreateDraftId(page)).not.toBe(discardedDraftId);
  await expect.poll(() => readCreateDraft(page, discardedDraftId)).toBeNull();
});

test('richiede la persistenza soltanto dal pulsante delle impostazioni', async ({ page }) => {
  await openApp(page, { mockStorage: true });

  expect(await page.evaluate(() => window.__storageTestState.persistCalls)).toBe(0);

  await page.getByRole('button', { name: 'Impostazioni', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Impostazioni', level: 1 })
  ).toBeVisible();

  const callsBeforeClick = await page.evaluate(() => ({
    estimate: window.__storageTestState.estimateCalls,
    persisted: window.__storageTestState.persistedCalls,
    persist: window.__storageTestState.persistCalls
  }));
  expect(callsBeforeClick.estimate).toBeGreaterThan(0);
  expect(callsBeforeClick.persisted).toBeGreaterThan(0);
  expect(callsBeforeClick.persist).toBe(0);

  await page.getByRole('button', { name: 'Proteggi archivio' }).click();

  await expect.poll(
    () => page.evaluate(() => window.__storageTestState.persistCalls)
  ).toBe(1);
  await expect(page.locator('#storage-health-status')).toContainText(/protett/i);
  await expect(
    page.getByRole('button', { name: 'Proteggi archivio' })
  ).toHaveCount(0);
  expect(await page.evaluate(() => window.__storageTestState.persistCalls)).toBe(1);
});
