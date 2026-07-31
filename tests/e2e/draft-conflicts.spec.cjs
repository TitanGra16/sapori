const { test, expect } = require('@playwright/test');

const APP_URL =
  'http://localhost:4173/index.html?draft-conflicts-e2e=1';

async function openApp(page, url = APP_URL) {
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
  await openApp(page);
  await expect(page.locator('.home-view h1')).toHaveText('Le mie ricette');
}

async function openCreateForm(page) {
  await page.getByRole('button', { name: 'Nuova ricetta', exact: true }).click();
  await expect(page.locator('#recipe-form')).toBeVisible();
  await expect(page).toHaveURL(/#create\/[^/]+$/);
  return createTargetFromUrl(page.url());
}

function createTargetFromUrl(url) {
  const match = new URL(url).hash.match(/^#create\/([^/]+)$/);
  expect(match, `URL di creazione privo di draftId: ${url}`).not.toBeNull();
  return {
    mode: 'create',
    draftId: decodeURIComponent(match[1])
  };
}

async function readDraft(page, target) {
  return page.evaluate(async draftTarget => {
    const record = await DraftStore.get(draftTarget);
    return record
      ? {
          draftId: record.draftId,
          revision: record.revision,
          writerId: record.writerId,
          data: record.data
        }
      : null;
  }, target);
}

async function waitForDraftRevision(page, target, minimumRevision) {
  await expect
    .poll(async () => {
      const record = await readDraft(page, target);
      return record ? record.revision : 0;
    })
    .toBeGreaterThan(minimumRevision);
}

async function waitForDraftSaved(page) {
  await expect(page.locator('#draft-save-status')).toHaveAttribute(
    'data-status',
    'saved',
    { timeout: 10_000 }
  );
}

async function createSharedDraft(page, context) {
  await openHome(page);
  const target = await openCreateForm(page);
  await page.locator('#input-name').fill('Versione iniziale condivisa');
  await waitForDraftSaved(page);

  const initialRecord = await readDraft(page, target);
  expect(initialRecord).not.toBeNull();

  const otherPage = await context.newPage();
  await openApp(otherPage, page.url());
  await expect(otherPage.locator('#recipe-form')).toBeVisible();
  await expect(otherPage.locator('#input-name')).toHaveValue(
    'Versione iniziale condivisa'
  );
  await expect(otherPage.locator('#draft-save-status')).toHaveAttribute(
    'data-status',
    'recovered'
  );

  await page.locator('#input-name').fill('Versione salvata dalla prima scheda');
  await waitForDraftRevision(page, target, initialRecord.revision);
  const winningRecord = await readDraft(page, target);

  await otherPage.locator('#input-name').fill(
    'Modifica locale della seconda scheda'
  );
  await expect(otherPage.locator('#draft-save-status')).toHaveAttribute(
    'data-status',
    'conflict',
    { timeout: 10_000 }
  );

  return {
    otherPage,
    target,
    winningRecord
  };
}

async function installDraftSaveFailure(page) {
  await page.evaluate(() => {
    window.__draftSaveFailureEnabled = true;
    window.__draftSaveOriginal = DraftStore.save;
    DraftStore.save = function () {
      if (window.__draftSaveFailureEnabled) {
        const error = new Error('Errore di salvataggio simulato dal test');
        error.code = 'TEST_DRAFT_SAVE_FAILURE';
        return Promise.reject(error);
      }
      return window.__draftSaveOriginal.apply(DraftStore, arguments);
    };
  });
}

async function requestSettingsNavigation(page) {
  await page.evaluate(() => {
    location.hash = '#settings';
  });
  const unsavedDialog = page.getByRole('dialog');
  await expect(
    unsavedDialog.getByRole('heading', { name: 'Modifiche non salvate' })
  ).toBeVisible();
  await unsavedDialog.locator('[data-action="modal-confirm"]').click();
}

async function expectCloseFailure(page) {
  const failureDialog = page.getByRole('dialog');
  await expect(
    failureDialog.getByRole('heading', {
      name: 'Ultima modifica non salvata'
    })
  ).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('#recipe-form')).toBeVisible();
  await expect(page.locator('.form-view')).not.toHaveAttribute('inert', '');
  return failureDialog;
}

test('due schede sulla stessa bozza rilevano il conflitto senza sovrascrivere', async ({
  page,
  context
}) => {
  const { otherPage, target, winningRecord } = await createSharedDraft(
    page,
    context
  );

  const storedAfterConflict = await readDraft(otherPage, target);
  expect(storedAfterConflict.revision).toBe(winningRecord.revision);
  expect(storedAfterConflict.writerId).toBe(winningRecord.writerId);
  expect(storedAfterConflict.data.recipe.name).toBe(
    'Versione salvata dalla prima scheda'
  );
  await expect(otherPage.locator('#input-name')).toHaveValue(
    'Modifica locale della seconda scheda'
  );
  await expect(
    otherPage.locator('[data-action="duplicate-conflicted-draft"]')
  ).toBeVisible();
  await expect(
    otherPage.locator('[data-action="reload-conflicted-draft"]')
  ).toBeVisible();
});

test('Continua in una copia conserva entrambe le versioni della bozza', async ({
  page,
  context
}) => {
  const { otherPage, target, winningRecord } = await createSharedDraft(
    page,
    context
  );
  const originalUrl = otherPage.url();

  await otherPage
    .locator('[data-action="duplicate-conflicted-draft"]')
    .click();
  await expect
    .poll(() => otherPage.url())
    .not.toBe(originalUrl);
  await expect(otherPage).toHaveURL(/#create\/[^/]+$/);
  await expect(otherPage.locator('#input-name')).toHaveValue(
    'Modifica locale della seconda scheda'
  );

  const copyTarget = createTargetFromUrl(otherPage.url());
  expect(copyTarget.draftId).not.toBe(target.draftId);

  const [originalRecord, copiedRecord] = await Promise.all([
    readDraft(otherPage, target),
    readDraft(otherPage, copyTarget)
  ]);
  expect(originalRecord.revision).toBe(winningRecord.revision);
  expect(originalRecord.data.recipe.name).toBe(
    'Versione salvata dalla prima scheda'
  );
  expect(copiedRecord).not.toBeNull();
  expect(copiedRecord.data.recipe.name).toBe(
    'Modifica locale della seconda scheda'
  );
});

test('Carica l’altra scheda sostituisce soltanto la versione locale in conflitto', async ({
  page,
  context
}) => {
  const { otherPage, target, winningRecord } = await createSharedDraft(
    page,
    context
  );

  await otherPage
    .locator('[data-action="reload-conflicted-draft"]')
    .click();
  const reloadDialog = otherPage.getByRole('dialog');
  await expect(
    reloadDialog.getByRole('heading', {
      name: /Caricare la bozza dell.*altra scheda/
    })
  ).toBeVisible();
  await reloadDialog
    .getByRole('button', { name: 'Carica versione recente' })
    .click();

  await expect(otherPage.locator('#input-name')).toHaveValue(
    'Versione salvata dalla prima scheda'
  );
  await expect(otherPage.locator('#draft-save-status')).toHaveAttribute(
    'data-status',
    'recovered'
  );

  const storedRecord = await readDraft(otherPage, target);
  expect(storedRecord.revision).toBe(winningRecord.revision);
  expect(storedRecord.data.recipe.name).toBe(
    'Versione salvata dalla prima scheda'
  );
});

test('un errore di chiusura mantiene il modulo e consente di riprovare', async ({
  page
}) => {
  await openHome(page);
  const target = await openCreateForm(page);
  await page.locator('#input-name').fill('Versione già salvata');
  await waitForDraftSaved(page);
  const durableRecord = await readDraft(page, target);

  await installDraftSaveFailure(page);
  await page.locator('#input-name').fill('Ultima modifica da recuperare');
  const draftUrl = page.url();
  await requestSettingsNavigation(page);
  const failureDialog = await expectCloseFailure(page);

  await expect(page).toHaveURL(draftUrl);
  await expect(page.locator('#input-name')).toHaveValue(
    'Ultima modifica da recuperare'
  );
  const unchangedRecord = await readDraft(page, target);
  expect(unchangedRecord.revision).toBe(durableRecord.revision);
  expect(unchangedRecord.data.recipe.name).toBe('Versione già salvata');

  await failureDialog
    .getByRole('button', { name: 'Resta e riprova' })
    .click();
  await page.evaluate(() => {
    window.__draftSaveFailureEnabled = false;
  });
  await requestSettingsNavigation(page);

  await expect(page).toHaveURL(/#settings$/);
  await expect(
    page.getByRole('heading', { name: 'Impostazioni', level: 1 })
  ).toBeVisible();
  await waitForDraftRevision(page, target, durableRecord.revision);
  const recoveredRecord = await readDraft(page, target);
  expect(recoveredRecord.data.recipe.name).toBe(
    'Ultima modifica da recuperare'
  );
});

test('Esci senza ultima modifica conserva l’ultima bozza già durevole', async ({
  page
}) => {
  await openHome(page);
  const target = await openCreateForm(page);
  await page.locator('#input-name').fill('Versione durevole');
  await waitForDraftSaved(page);
  const durableRecord = await readDraft(page, target);

  await installDraftSaveFailure(page);
  await page.locator('#input-name').fill('Versione non salvabile');
  await requestSettingsNavigation(page);
  const failureDialog = await expectCloseFailure(page);

  await failureDialog
    .getByRole('button', { name: 'Esci senza ultima modifica' })
    .click();
  await expect(page).toHaveURL(/#settings$/);
  await expect(
    page.getByRole('heading', { name: 'Impostazioni', level: 1 })
  ).toBeVisible();

  const preservedRecord = await readDraft(page, target);
  expect(preservedRecord.revision).toBe(durableRecord.revision);
  expect(preservedRecord.data.recipe.name).toBe('Versione durevole');
});
