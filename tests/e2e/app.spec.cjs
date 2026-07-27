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
  await page.getByRole('textbox', { name: 'Conservazione' }).fill('In frigorifero per 2 giorni.');

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

test('crea, apre e prepara la stampa di una ricetta completa', async ({ page }) => {
  await fillMinimumRecipe(page);

  await expect(page.getByRole('heading', { name: 'Ricetta automatica', level: 3 })).toBeVisible();
  await page.getByRole('link', { name: 'Apri la ricetta Ricetta automatica' }).click();
  await expect(page.getByRole('heading', { name: 'Ricetta automatica', level: 1 })).toBeVisible();
  await expect(page.getByText('Note conservate.')).toBeVisible();
  await expect(page.getByText('In frigorifero per 2 giorni.')).toBeVisible();
  await expect(page.getByText('Farina')).toBeVisible();

  await page.getByRole('button', { name: 'Esporta PDF' }).click();
  const printDialog = page.getByRole('dialog', { name: 'Ricetta automatica' });
  await expect(printDialog).toBeVisible();
  await expect(printDialog.getByText('Mescolare tutti gli ingredienti.')).toBeVisible();
  await expect(printDialog.getByText('Tempo totale')).toBeVisible();
  await expect(printDialog.getByText('30 min', { exact: true })).toBeVisible();

  await page.evaluate(() => {
    window.__printSnapshot = null;
    window.print = () => {
      const root = document.querySelector('.print-document-root--preview');
      window.__printSnapshot = {
        bodyClassActive: document.body.classList.contains('printing-preview'),
        sheets: root ? root.querySelectorAll('.print-recipe-sheet').length : 0,
        title: root ? root.querySelector('.print-recipe-sheet__title').textContent : ''
      };
    };
  });
  await printDialog.getByRole('button', { name: /Stampa o salva PDF/i }).click();
  await expect.poll(() => page.evaluate(() => window.__printSnapshot)).toEqual({
    bodyClassActive: true,
    sheets: 1,
    title: 'Ricetta automatica'
  });
});

test('prepara copertina, indice numerato e schede coerenti nel ricettario PDF', async ({ page }) => {
  await page.evaluate(async () => {
    const base = {
      category: 'primi',
      description: 'Descrizione da ricettario.',
      ingredients: [{ name: 'Farina', quantity: '100', unit: 'g', notes: '' }],
      steps: [{ text: 'Impastare con cura.', notes: '' }],
      prepTime: 10,
      cookTime: 20,
      servings: 4,
      difficulty: 'facile',
      notes: '',
      image: null,
      imageThumbnail: null,
      isFavorite: false
    };
    await DB.addRecipe({ ...base, name: 'Zuppa' });
    await DB.addRecipe({ ...base, name: 'Arrosto' });
  });

  await page.getByRole('button', { name: 'Impostazioni' }).click();
  await page.evaluate(() => {
    window.__cookbookSnapshot = null;
    window.print = () => {
      const root = document.querySelector('.print-document-root--cookbook');
      window.__cookbookSnapshot = {
        bodyClassActive: document.body.classList.contains('printing-all-recipes'),
        sheets: root ? root.querySelectorAll('.print-recipe-sheet').length : 0,
        index: root
          ? Array.from(root.querySelectorAll('.print-index-item')).map(item => item.textContent.trim())
          : [],
        titles: root
          ? Array.from(root.querySelectorAll('.print-recipe-sheet__title')).map(item => item.textContent)
          : []
      };
    };
  });

  await page.getByRole('button', { name: 'Ricettario PDF' }).click();
  await expect.poll(() => page.evaluate(() => window.__cookbookSnapshot)).toEqual({
    bodyClassActive: true,
    sheets: 2,
    index: ['01ArrostoPrimi Piatti', '02ZuppaPrimi Piatti'],
    titles: ['Arrosto', 'Zuppa']
  });
});

test('condivide cartolina, testo completo e file ricetta portabile', async ({ page }) => {
  await fillMinimumRecipe(page, 'Crème brûlée');
  await page.getByRole('link', { name: 'Apri la ricetta Crème brûlée' }).click();

  await page.evaluate(() => {
    window.__copiedRecipe = '';
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async text => {
          window.__copiedRecipe = text;
        }
      }
    });
  });

  await page.getByRole('button', { name: 'Condividi' }).click();
  const shareDialog = page.getByRole('dialog', { name: 'Crème brûlée' });
  await expect(shareDialog).toBeVisible();
  await expect(shareDialog.getByText('Questo link apre Sapori, ma non contiene la ricetta.')).toBeVisible();
  await expect(shareDialog.getByRole('button', { name: /Cartolina PNG/ })).toBeVisible();
  await expect(shareDialog.getByRole('button', { name: /Testo completo/ })).toBeVisible();
  await expect(shareDialog.getByRole('button', { name: /File ricetta/ })).toBeVisible();
  await expect(shareDialog.getByRole('button', { name: /WhatsApp/ })).toBeVisible();
  await expect(shareDialog.getByRole('button', { name: /Telegram/ })).toBeVisible();

  const cardSize = await shareDialog.locator('.share-modal__preview-img').evaluate(image => ({
    width: image.naturalWidth,
    height: image.naturalHeight
  }));
  expect(cardSize).toEqual({ width: 1080, height: 1350 });

  await shareDialog.getByRole('button', { name: /Testo completo/ }).click();
  await expect.poll(() => page.evaluate(() => window.__copiedRecipe)).toContain('INGREDIENTI');
  expect(await page.evaluate(() => window.__copiedRecipe)).toContain('Mescolare tutti gli ingredienti.');

  const downloadPromise = page.waitForEvent('download');
  await shareDialog.getByRole('button', { name: /File ricetta/ }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('creme_brulee_ricetta_sapori.json');
  const stream = await download.createReadStream();
  let downloadedJson = '';
  for await (const chunk of stream) downloadedJson += chunk.toString('utf8');
  const portableRecipe = JSON.parse(downloadedJson);
  expect(portableRecipe.name).toBe('Crème brûlée');
  expect(portableRecipe.ingredients[0].name).toBe('Farina');

  const nativeFallback = await page.evaluate(async () => {
    const recipe = (await DB.getAllRecipes())[0];
    Object.defineProperty(navigator, 'canShare', {
      configurable: true,
      value: ({ files }) => files.length === 1 && files[0].type === 'image/png'
    });
    const payload = Share._buildNativeSharePayload(
      recipe,
      { type: 'image/png' },
      { type: 'application/json' },
      'testo completo'
    );
    return {
      fileTypes: payload.files.map(file => file.type),
      title: payload.title
    };
  });
  expect(nativeFallback).toEqual({
    fileTypes: ['image/png'],
    title: 'Crème brûlée'
  });

  await expectNoHorizontalOverflow(page);
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
  await expect(page.getByRole('heading', { name: 'Il tuo ricettario è vuoto' })).toBeVisible();
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

test('adatta box e navigazione senza overflow al viewport corrente', async ({ page }) => {
  const viewport = page.viewportSize();
  await expectNoHorizontalOverflow(page);

  await page.getByRole('button', { name: 'Impostazioni' }).click();
  await expect(page.getByRole('heading', { name: 'Impostazioni' })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  const settingsView = await page.locator('.settings-view').boundingBox();
  expect(settingsView.width).toBeLessThanOrEqual(1160);
  const navigation = await page.locator('#bottom-nav').boundingBox();
  if (viewport.width >= 1024) {
    expect(navigation.y).toBeLessThan(80);
    const dataCard = await page.locator('.settings-card--data').boundingBox();
    const infoCard = await page.locator('.settings-card--info').boundingBox();
    expect(Math.abs(dataCard.y - infoCard.y)).toBeLessThanOrEqual(1);
  } else {
    expect(navigation.y + navigation.height).toBeGreaterThan(viewport.height - 2);
  }

  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await page.getByRole('button', { name: '👨‍🍳 Svuotafrigo' }).click();
  await expect(page.getByRole('heading', { name: '👨‍🍳 Svuotafrigo' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  const pantryHeader = await page.locator('.pantry-header').boundingBox();
  expect(pantryHeader.y).toBeLessThan(100);

  await page.getByRole('button', { name: 'Torna indietro' }).click();
  await page.getByRole('button', { name: 'Nuova ricetta' }).click();
  await expect(page.getByRole('heading', { name: 'Nuova Ricetta' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  const editor = await page.locator('.recipe-editor').boundingBox();
  const formHeader = await page.locator('.form-view > .view-header').boundingBox();
  expect(editor.width).toBeLessThanOrEqual(880);
  expect(formHeader.y).toBeLessThan(100);
});
