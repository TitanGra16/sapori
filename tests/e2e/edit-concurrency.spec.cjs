const { test, expect } = require('@playwright/test');

const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGP4z8DAwMDAxMDAwMAAAAkAAf8B9e0AAAAASUVORK5CYII=';
const TINY_PNG_DATA_URL = `data:image/png;base64,${TINY_PNG_BASE64}`;
const TEST_THUMBNAIL_DATA_URL = 'data:image/jpeg;base64,AA==';

async function openApp(page) {
  await page.addInitScript(() => {
    localStorage.setItem('sapori-warning-dismissed', 'true');
  });
  await page.goto('/index.html?edit-concurrency-e2e=1');

  const warningButton = page.getByRole('button', { name: 'Ho capito' });
  if (await warningButton.isVisible().catch(() => false)) {
    await warningButton.click();
  }

  await expect(page.locator('.home-view h1')).toHaveText('Le mie ricette');
}

async function seedRecipe(page, name = 'Ricetta da modificare') {
  return page.evaluate(async recipeName => {
    const id = await DB.addRecipe({
      name: recipeName,
      category: 'altro',
      description: 'Versione iniziale',
      notes: '',
      storage: '',
      ingredients: [{ name: 'Farina', quantity: '100', unit: 'g', notes: '' }],
      steps: [{ text: 'Mescolare.', notes: '' }],
      prepTime: 5,
      cookTime: 10,
      servings: 2,
      difficulty: 'facile',
      image: null,
      imageThumbnail: null,
      isFavorite: false
    });
    const recipe = await DB.getRecipe(id);
    return {
      id,
      contentVersion: recipe.contentVersion
    };
  }, name);
}

async function openEditForm(page, recipeId) {
  await page.goto(
    '/index.html?edit-concurrency-e2e=1#edit/' + encodeURIComponent(recipeId)
  );
  await expect(page.locator('#recipe-form')).toBeVisible();
  await expect(page).toHaveURL(/#edit\/[^/]+\/[^/]+$/);
  return getEditDraftId(page, recipeId);
}

function getEditDraftId(page, recipeId) {
  const hash = new URL(page.url()).hash;
  const parts = hash.replace(/^#/, '').split('/');
  expect(parts[0]).toBe('edit');
  expect(decodeURIComponent(parts[1])).toBe(recipeId);
  expect(parts[2]).toBeTruthy();
  return decodeURIComponent(parts[2]);
}

async function openCreateForm(page) {
  await page.getByRole('button', { name: 'Nuova ricetta', exact: true }).click();
  await expect(page.locator('#recipe-form')).toBeVisible();
  await expect(page).toHaveURL(/#create\/[^/]+$/);
  return decodeURIComponent(new URL(page.url()).hash.split('/')[1]);
}

async function fillValidCreateForm(page, name) {
  await page.locator('#input-name').fill(name);
  await page.locator('#input-description').fill('Descrizione del test concorrente.');
  await page.getByRole('tab', { name: 'Ingredienti e preparazione' }).click();
  await page.locator('[data-field="ing-name"]').first().fill('Farina');
  await page.locator('[data-field="ing-qty"]').first().fill('100');
  await page.locator('[data-field="step-text"]').first().fill('Mescolare con cura.');
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
          writerId: record.writerId,
          data: record.data
        }
      : null;
  }, target);
}

async function installDelayedImagePipeline(page) {
  await page.evaluate(() => {
    window.__auditCompressionStarted = false;
    window.__auditResolveCompression = null;
    Utils.compressImage = () => {
      window.__auditCompressionStarted = true;
      return new Promise(resolve => {
        window.__auditResolveCompression = resolve;
      });
    };
    Utils.createImageThumbnail = async () => 'data:image/jpeg;base64,AA==';
  });
}

async function selectTestImage(page) {
  await page.locator('#input-image').setInputFiles({
    name: 'foto-test.png',
    mimeType: 'image/png',
    buffer: Buffer.from(TINY_PNG_BASE64, 'base64')
  });
  await expect.poll(
    () => page.evaluate(() => window.__auditCompressionStarted)
  ).toBe(true);
}

test('salva una modifica reale e incrementa contentVersion', async ({ page }) => {
  await openApp(page);
  const seeded = await seedRecipe(page);
  await openEditForm(page, seeded.id);

  await expect(page.locator('#input-content-version')).toHaveValue(
    String(seeded.contentVersion)
  );
  await page.locator('#input-description').fill('Versione realmente aggiornata');
  await page.getByRole('tab', { name: 'Dettagli di cottura' }).click();
  await page.getByRole('button', { name: /Salva modifiche/i }).click();

  await expect(page).toHaveURL(/#home$/);
  const updated = await page.evaluate(id => DB.getRecipe(id), seeded.id);
  expect(updated.description).toBe('Versione realmente aggiornata');
  expect(updated.contentVersion).toBe(seeded.contentVersion + 1);
});

test('un conflitto concorrente non sovrascrive e conserva la seconda bozza', async ({
  page,
  context
}) => {
  await openApp(page);
  const seeded = await seedRecipe(page, 'Ricetta concorrente');
  const secondPage = await context.newPage();
  await openApp(secondPage);

  await openEditForm(page, seeded.id);
  const secondDraftId = await openEditForm(secondPage, seeded.id);

  await page.locator('#input-description').fill('Modifica vincente della prima scheda');
  await page.getByRole('tab', { name: 'Dettagli di cottura' }).click();
  await page.getByRole('button', { name: /Salva modifiche/i }).click();
  await expect(page).toHaveURL(/#home$/);

  await secondPage.locator('#input-description').fill(
    'Modifica concorrente da conservare'
  );
  await waitForDraftSaved(secondPage);
  const secondHash = new URL(secondPage.url()).hash;
  await secondPage.getByRole('tab', { name: 'Dettagli di cottura' }).click();
  await secondPage.getByRole('button', { name: /Salva modifiche/i }).click();

  await expect.poll(() => secondPage.evaluate(() => location.hash)).toBe(secondHash);
  await expect(
    secondPage.getByText(/La ricetta è cambiata in un’altra scheda/i)
  ).toBeVisible();
  await secondPage.getByRole('tab', { name: 'Informazioni generali' }).click();
  await expect(secondPage.locator('#input-description')).toHaveValue(
    'Modifica concorrente da conservare'
  );

  const storedRecipe = await secondPage.evaluate(id => DB.getRecipe(id), seeded.id);
  expect(storedRecipe.description).toBe('Modifica vincente della prima scheda');
  expect(storedRecipe.contentVersion).toBe(seeded.contentVersion + 1);

  const preservedDraft = await readDraft(secondPage, {
    mode: 'edit',
    recipeId: seeded.id,
    draftId: secondDraftId
  });
  expect(preservedDraft).not.toBeNull();
  expect(preservedDraft.data.recipe.description).toBe(
    'Modifica concorrente da conservare'
  );
  expect(preservedDraft.data.recipe.contentVersion).toBe(seeded.contentVersion);
});

test('un save lento blocca annullamento e navigazione senza toccare altre bozze', async ({
  page,
  context
}) => {
  await openApp(page);
  const secondPage = await context.newPage();
  await openApp(secondPage);

  const otherDraftId = await openCreateForm(secondPage);
  await secondPage.locator('#input-name').fill('Bozza indipendente');
  await waitForDraftSaved(secondPage);
  const otherDraftBefore = await readDraft(secondPage, {
    mode: 'create',
    draftId: otherDraftId
  });

  const savingDraftId = await openCreateForm(page);
  await fillValidCreateForm(page, 'Ricetta con salvataggio lento');
  await page.getByRole('tab', { name: 'Dettagli di cottura' }).click();
  await waitForDraftSaved(page);

  await page.evaluate(() => {
    const originalAddRecipe = DB.addRecipe.bind(DB);
    window.__auditSlowSaveStarted = false;
    window.__auditReleaseSlowSave = null;
    DB.addRecipe = recipe => new Promise((resolve, reject) => {
      window.__auditSlowSaveStarted = true;
      window.__auditReleaseSlowSave = () => {
        return originalAddRecipe(recipe).then(resolve, reject);
      };
    });
  });

  const originalHash = new URL(page.url()).hash;
  await page.getByRole('button', { name: /Salva ricetta/i }).click();
  await expect.poll(
    () => page.evaluate(() => window.__auditSlowSaveStarted)
  ).toBe(true);
  await expect(page.locator('#app-content')).toHaveAttribute('inert', '');
  await expect(page.locator('#app-content')).toHaveAttribute('aria-busy', 'true');

  const cancelWasBlocked = await page
    .locator('.view-back-button[data-action="cancel-form"]')
    .click({ timeout: 600 })
    .then(() => false, () => true);
  expect(cancelWasBlocked).toBe(true);
  await expect(page.locator('#modal-overlay')).toHaveClass(/\bhidden\b/);

  await page.evaluate(() => {
    location.hash = '#home';
  });
  await expect.poll(() => page.evaluate(() => location.hash)).toBe(originalHash);

  await page.evaluate(() => window.__auditReleaseSlowSave());
  await expect(page).toHaveURL(/#home$/);
  await expect.poll(() => readDraft(page, {
    mode: 'create',
    draftId: savingDraftId
  })).toBeNull();

  const otherDraftAfter = await readDraft(secondPage, {
    mode: 'create',
    draftId: otherDraftId
  });
  expect(otherDraftAfter.revision).toBe(otherDraftBefore.revision);
  expect(otherDraftAfter.data.recipe.name).toBe('Bozza indipendente');
  await expect(secondPage.locator('#input-name')).toHaveValue('Bozza indipendente');
});

test('una foto tardiva del modulo A non contamina il nuovo modulo B', async ({ page }) => {
  await openApp(page);
  await openCreateForm(page);
  await installDelayedImagePipeline(page);
  await selectTestImage(page);

  await page.getByRole('button', { name: 'Annulla e torna indietro' }).click();
  await expect(page).toHaveURL(/#home$/);

  const secondDraftId = await openCreateForm(page);
  await page.locator('#input-name').fill('Modulo B');
  await waitForDraftSaved(page);
  const secondDraftBefore = await readDraft(page, {
    mode: 'create',
    draftId: secondDraftId
  });

  await page.evaluate(imageData => {
    window.__auditResolveCompression(imageData);
  }, TINY_PNG_DATA_URL);
  await page.waitForTimeout(100);

  await expect(page.locator('#input-image-data')).toHaveValue('');
  await expect(page.locator('#input-image-thumbnail-data')).toHaveValue('');
  await expect(page.locator('#image-preview')).toHaveCount(0);

  const secondDraftAfter = await readDraft(page, {
    mode: 'create',
    draftId: secondDraftId
  });
  expect(secondDraftAfter.revision).toBe(secondDraftBefore.revision);
  expect(secondDraftAfter.data.recipe.name).toBe('Modulo B');
  expect(secondDraftAfter.data.recipe.image).toBeNull();
});

test('il salvataggio attende la foto ancora in preparazione', async ({ page }) => {
  await openApp(page);
  await openCreateForm(page);
  await fillValidCreateForm(page, 'Ricetta con foto pendente');
  await page.getByRole('tab', { name: 'Informazioni generali' }).click();
  await installDelayedImagePipeline(page);
  await selectTestImage(page);
  await page.getByRole('tab', { name: 'Dettagli di cottura' }).click();

  await page.getByRole('button', { name: /Salva ricetta/i }).click();
  await expect(page.locator('#app-content')).toHaveAttribute('inert', '');
  expect(await page.evaluate(() => DB.countRecipes())).toBe(0);

  await page.evaluate(imageData => {
    window.__auditResolveCompression(imageData);
  }, TINY_PNG_DATA_URL);

  await expect(page).toHaveURL(/#home$/);
  const savedRecipe = await page.evaluate(async expectedName => {
    const recipes = await DB.getAllRecipes();
    return recipes.find(recipe => recipe.name === expectedName) || null;
  }, 'Ricetta con foto pendente');
  expect(savedRecipe).not.toBeNull();
  expect(savedRecipe.image).toBe(TINY_PNG_DATA_URL);
  expect(savedRecipe.imageThumbnail).toBe(TEST_THUMBNAIL_DATA_URL);
});
