const { test, expect } = require('@playwright/test');

async function openCleanApp(page) {
  await page.goto('/index.html?e2e=1');
  const warningButton = page.getByRole('button', { name: 'Ho capito' });
  if (await warningButton.isVisible().catch(() => false)) {
    await warningButton.click();
  }
}

async function fillMinimumRecipeForm(page, name = 'Ricetta automatica') {
  await page.getByRole('button', { name: 'Nuova ricetta' }).click();
  await page.getByRole('textbox', { name: 'Nome ricetta' }).fill(name);
  await page.getByRole('textbox', { name: 'Descrizione' }).fill('Descrizione creata dal test end-to-end.');
  await page.getByRole('textbox', { name: 'Note' }).fill('Note conservate.');

  await page.getByRole('tab', { name: 'Ingredienti e preparazione' }).click();
  await page.getByRole('textbox', { name: 'Ingrediente *', exact: true }).fill('Farina');
  await page.getByRole('textbox', { name: 'Qtà' }).fill('100');
  await page.getByRole('textbox', { name: 'Descrivi il passaggio' }).fill('Mescolare tutti gli ingredienti.');

  await page.getByRole('tab', { name: 'Dettagli di cottura' }).click();
  await page.getByRole('spinbutton', { name: 'Tempo preparazione' }).fill('10');
  await page.getByRole('spinbutton', { name: 'Tempo cottura' }).fill('20');
}

async function fillMinimumRecipe(page, name = 'Ricetta automatica') {
  await fillMinimumRecipeForm(page, name);
  await page.getByRole('button', { name: 'Salva Ricetta' }).click();
}

test.beforeEach(async ({ page }) => {
  await openCleanApp(page);
});

test('crea, apre e prepara la stampa di una ricetta completa', async ({ page }) => {
  await fillMinimumRecipe(page);

  await expect(page.getByRole('heading', { name: 'Ricetta automatica', level: 3 })).toBeVisible();
  await page.getByRole('link', { name: 'Apri la ricetta Ricetta automatica' }).click();
  await expect(page.getByRole('heading', { name: 'Ricetta automatica', level: 1 })).toBeVisible();
  await expect(page.getByText('Note conservate.')).toBeVisible();
  await expect(page.getByText('Farina')).toBeVisible();

  await page.getByRole('button', { name: 'Esporta PDF' }).click();
  const printDialog = page.getByRole('dialog', { name: 'Ricetta automatica' });
  await expect(printDialog).toBeVisible();
  await expect(printDialog.getByText('Mescolare tutti gli ingredienti.')).toBeVisible();
  await expect(printDialog.getByRole('button', { name: /Stampa.*Salva PDF/ })).toBeEnabled();
});

test('salva la foto completa separata dalla miniatura delle card', async ({ page }) => {
  await fillMinimumRecipeForm(page, 'Ricetta con foto');
  await page.locator('#input-image').setInputFiles({
    name: 'foto.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGP4z8DAwMDAxMDAwMAAAAkAAf8B9e0AAAAASUVORK5CYII=',
      'base64'
    )
  });
  await page.getByRole('tab', { name: 'Informazioni generali' }).click();
  await expect(page.locator('#image-preview')).toBeVisible();
  await expect.poll(() => page.locator('#input-image-thumbnail-data').inputValue()).toMatch(/^data:image\/jpeg;base64,/);
  await page.getByRole('tab', { name: 'Dettagli di cottura' }).click();
  await page.getByRole('button', { name: 'Salva Ricetta' }).click();

  await expect(page.getByRole('heading', { name: 'Ricetta con foto', level: 3 })).toBeVisible();
  const stored = await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('SaporiDB', 2);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(['recipes', 'images'], 'readonly');
      const recipeRequest = tx.objectStore('recipes').getAll();
      const imageRequest = tx.objectStore('images').getAll();
      tx.onerror = () => reject(tx.error);
      tx.oncomplete = () => {
        db.close();
        resolve({
          recipe: recipeRequest.result[0],
          image: imageRequest.result[0]
        });
      };
    };
  }));

  expect(stored.recipe.image).toBeNull();
  expect(stored.recipe.imageThumbnail).toMatch(/^data:image\/jpeg;base64,/);
  expect(stored.recipe.hasImage).toBe(true);
  expect(stored.image.data).toMatch(/^data:image\/jpeg;base64,/);
  await expect(page.locator('.recipe-card__image img')).toHaveAttribute('src', stored.recipe.imageThumbnail);

  await page.getByRole('link', { name: 'Apri la ricetta Ricetta con foto' }).click();
  await expect(page.locator('.recipe-detail__hero img')).toHaveAttribute('src', stored.image.data);
});

test('le righe dinamiche mantengono limiti e nomi accessibili', async ({ page }) => {
  await page.getByRole('button', { name: 'Nuova ricetta' }).click();
  await page.getByRole('tab', { name: 'Ingredienti e preparazione' }).click();
  await page.getByRole('button', { name: 'Aggiungi ingrediente' }).click();
  await page.getByRole('button', { name: 'Aggiungi passaggio' }).click();

  const ingredients = page.locator('[data-field="ing-name"]');
  const steps = page.locator('[data-field="step-text"]');
  await expect(ingredients).toHaveCount(2);
  await expect(steps).toHaveCount(2);
  await expect(ingredients.nth(1)).toHaveAttribute('maxlength', '160');
  await expect(steps.nth(1)).toHaveAttribute('maxlength', '2000');
  await expect(page.getByRole('button', { name: 'Rimuovi ingrediente 2' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Rimuovi passaggio 2' })).toBeVisible();
});

test('protegge una bozza e intrappola il focus nella conferma', async ({ page }) => {
  await page.getByRole('button', { name: 'Nuova ricetta' }).click();
  await page.getByRole('textbox', { name: 'Nome ricetta' }).fill('Bozza non salvata');
  await page.getByRole('button', { name: 'Annulla e torna indietro' }).click();

  const dialog = page.getByRole('dialog', { name: 'Uscire dal modulo?' });
  await expect(dialog).toBeVisible();
  await expect(page.locator('#app-content')).toHaveAttribute('inert', '');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('textbox', { name: 'Nome ricetta' })).toHaveValue('Bozza non salvata');

  await page.getByRole('button', { name: 'Annulla e torna indietro' }).click();
  await dialog.getByRole('button', { name: 'Conferma' }).click();
  await expect(page.getByRole('heading', { name: 'Nessuna ricetta ancora!' })).toBeVisible();
});

test('applica tema e palette dalle impostazioni', async ({ page }) => {
  await page.getByRole('button', { name: 'Impostazioni' }).click();
  const toggle = page.getByRole('checkbox', { name: 'Tema scuro' });
  const initialTheme = await page.locator('html').getAttribute('data-theme');
  await page.locator('label.toggle-switch').click();
  await expect(page.locator('html')).toHaveAttribute(
    'data-theme',
    initialTheme === 'dark' ? 'light' : 'dark'
  );
  expect(await toggle.isChecked()).toBe(initialTheme !== 'dark');

  await page.getByRole('button', { name: 'Oceano', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'oceano');
});

test('tutte le palette rispettano il contrasto AA nei due temi', async ({ page }) => {
  await page.getByRole('button', { name: 'Impostazioni' }).click();
  const toggle = page.getByRole('checkbox', { name: 'Tema scuro' });
  if (await toggle.isChecked()) await page.locator('label.toggle-switch').click();

  for (const palette of ['classico', 'oceano', 'bosco', 'tramonto', 'ametista', 'autunno', 'zafferano']) {
    await page.locator(`button[data-palette="${palette}"]`).click();

    for (const mode of ['light', 'dark']) {
      const result = await page.locator('html').evaluate(element => {
        const style = getComputedStyle(element);
        const get = property => style.getPropertyValue(property).trim();
        const luminance = hex => {
          const channels = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255)
            .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
          return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
        };
        const contrast = (first, second) => {
          const a = luminance(first);
          const b = luminance(second);
          return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        };
        const gradientColors = get('--gradient').match(/#[0-9a-f]{6}/gi) || [];
        const checks = [
          contrast(get('--text-muted'), get('--bg-primary')),
          contrast(get('--text-muted'), get('--bg-secondary')),
          contrast(get('--primary-ink'), get('--bg-primary')),
          contrast(get('--primary-ink'), get('--bg-secondary')),
          contrast(get('--on-danger'), get('--danger')),
          contrast(get('--on-success'), get('--success')),
          contrast(get('--on-warning'), get('--warning')),
          ...gradientColors.map(color => contrast(get('--on-primary'), color))
        ];
        return { mode: element.dataset.theme, minimum: Math.min(...checks) };
      });

      expect(result.mode).toBe(mode);
      expect(result.minimum, `${palette}-${mode}`).toBeGreaterThanOrEqual(4.5);
      if (mode === 'light') await page.locator('label.toggle-switch').click();
    }

    await page.locator('label.toggle-switch').click();
  }
});
