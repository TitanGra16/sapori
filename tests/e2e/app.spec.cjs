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
  await page.getByRole('textbox', { name: 'Nome ingrediente 1' }).fill('Farina');
  await page.getByRole('textbox', { name: 'Quantità ingrediente 1' }).fill('100');
  await page.getByRole('textbox', { name: 'Descrizione passaggio 1' }).fill('Mescolare tutti gli ingredienti.');

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
  await expect(page.getByRole('button', { name: 'Condividi' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Esporta PDF' })).toBeVisible();
  const favoriteButton = page.getByRole('button', { name: 'Aggiungi ai preferiti' });
  await expect(favoriteButton).toHaveAttribute('aria-pressed', 'false');
  await favoriteButton.click();
  await expect(page.getByRole('button', { name: 'Rimuovi dai preferiti' })).toHaveAttribute('aria-pressed', 'true');

  await page.evaluate(() => {
    window.__printSnapshot = null;
    window.print = () => {
      const root = document.querySelector('.print-document-root--recipe');
      window.__printSnapshot = {
        bodyClassActive: document.body.classList.contains('printing-recipe'),
        sheets: root ? root.querySelectorAll('.print-recipe-sheet').length : 0,
        title: root ? root.querySelector('.print-recipe-sheet__title').textContent : '',
        storage: root ? root.textContent.includes('In frigorifero per 2 giorni.') : false
      };
    };
  });
  await page.getByRole('button', { name: 'Esporta PDF' }).click();
  await expect.poll(() => page.evaluate(() => window.__printSnapshot)).toEqual({
    bodyClassActive: true,
    sheets: 1,
    title: 'Ricetta automatica',
    storage: true
  });
  await expect(page.getByRole('dialog', { name: 'Ricetta automatica' })).toHaveCount(0);
});

test('ripristina passaggio, ingredienti e timer della modalità cucina', async ({ page }) => {
  const recipeId = await page.evaluate(async () => {
    localStorage.setItem('sapori-warning-dismissed', 'true');
    return DB.addRecipe({
      name: 'Sessione cucina',
      category: 'primi',
      description: 'Ricetta usata per verificare la ripresa della sessione.',
      ingredients: [
        { name: 'Farina', quantity: '100', unit: 'g', notes: '' },
        { name: 'Acqua', quantity: '60', unit: 'ml', notes: '' }
      ],
      steps: [
        { text: 'Preparare gli ingredienti.', notes: '' },
        { text: 'Cuocere con attenzione.', notes: '' }
      ],
      prepTime: 10,
      cookTime: 20,
      servings: 2,
      difficulty: 'media',
      notes: '',
      storage: '',
      image: null,
      imageThumbnail: null,
      isFavorite: false
    });
  });

  await page.goto('/index.html?e2e=1#detail/' + encodeURIComponent(recipeId));
  await page.getByRole('button', { name: /Inizia la Cottura/ }).click();

  const firstIngredient = page.locator('[data-action="toggle-cooking-ing"][data-index="0"]');
  await firstIngredient.click();
  await page.getByRole('button', { name: /Avanti/ }).click();

  const minuteInput = page.getByRole('spinbutton', { name: 'Minuti' });
  await expect(minuteInput).toHaveAttribute('max', String(10080));
  await minuteInput.fill('120');
  await page.getByRole('spinbutton', { name: 'Secondi' }).fill('10');
  await page.getByRole('button', { name: 'Avvia timer' }).click();

  await expect.poll(() => page.evaluate(() => {
    const value = localStorage.getItem('sapori-cooking-session');
    return value ? JSON.parse(value).stepIndex : null;
  })).toBe(1);

  await page.reload();

  await expect(page.getByRole('dialog', { name: 'Sessione cucina' })).toBeVisible();
  await expect(page.getByText('Passaggio 2 di 2')).toBeVisible();
  await expect(page.locator('[data-action="toggle-cooking-ing"][data-index="0"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('spinbutton', { name: 'Minuti' })).toBeDisabled();
  await expect(page.getByRole('spinbutton', { name: 'Minuti' })).toHaveValue(/^(119|120)$/);

  await page.getByRole('button', { name: 'Chiudi Modalità Cucina' }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('sapori-cooking-session'))).toBeNull();
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
    DB.getAllRecipes = async () => {
      throw new Error('Il ricettario PDF non deve caricare le foto originali');
    };
  });

  await page.getByRole('button', { name: 'Impostazioni' }).click();
  await page.emulateMedia({ media: 'print' });
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
          : [],
        storageBlocks: root ? root.querySelectorAll('.print-recipe-sheet__storage').length : -1,
        singleColumnAftercare: root ? root.querySelectorAll('.print-recipe-sheet__aftercare--single').length : -1,
        firstAccentMarginTop: root
          ? getComputedStyle(root.querySelector('.print-recipe-sheet__accent')).marginTop
          : null
      };
    };
  });

  await page.getByRole('button', { name: 'Ricettario PDF' }).click();
  await expect.poll(() => page.evaluate(() => window.__cookbookSnapshot)).toEqual({
    bodyClassActive: true,
    sheets: 2,
    index: ['01ArrostoPrimi Piatti', '02ZuppaPrimi Piatti'],
    titles: ['Arrosto', 'Zuppa'],
    storageBlocks: 0,
    singleColumnAftercare: 2,
    firstAccentMarginTop: '0px'
  });
});

test('renderizza una scheda PDF reale con gli stili di stampa', async ({ page }) => {
  await page.evaluate(() => {
    const recipe = {
      name: 'Pane rustico',
      category: 'altro',
      description: 'Una descrizione abbastanza lunga per verificare la composizione della pagina stampata.',
      ingredients: [
        { name: 'Farina', quantity: '500', unit: 'g', notes: 'setacciata' },
        { name: 'Acqua', quantity: '350', unit: 'ml', notes: '' }
      ],
      steps: [
        { text: 'Impastare con cura fino a ottenere un composto omogeneo.', notes: 'Non aggiungere altra farina.' },
        { text: 'Lasciare lievitare e cuocere fino a doratura.', notes: '' }
      ],
      prepTime: 20,
      cookTime: 45,
      servings: 6,
      difficulty: 'media',
      notes: 'Controllare la cottura negli ultimi minuti.',
      storage: 'Conservare in un sacchetto di carta per due giorni.',
      image: null
    };
    const root = document.createElement('div');
    root.className = 'print-document-root print-document-root--recipe';
    root.innerHTML = Views.buildPrintableRecipeHTML(recipe);
    document.body.appendChild(root);
    document.body.classList.add('printing-recipe');
  });

  await page.emulateMedia({ media: 'print' });
  const pdf = await page.pdf({
    format: 'A4',
    printBackground: true,
    preferCSSPageSize: true
  });
  expect(Buffer.from(pdf).subarray(0, 5).toString()).toBe('%PDF-');
  expect(pdf.length).toBeGreaterThan(15000);
  await page.evaluate(() => {
    document.body.classList.remove('printing-recipe');
    document.querySelector('.print-document-root--recipe')?.remove();
  });
});

test('scarica il backup JSON e mostra la data dell’ultima esportazione', async ({ page }) => {
  await page.getByRole('button', { name: 'Impostazioni' }).click();
  await expect(page.getByText('Mai eseguito')).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Backup JSON' }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/^sapori-backup-\d{4}-\d{2}-\d{2}\.json$/);
  await expect(page.locator('#last-backup-status')).not.toHaveText('Mai eseguito');
  await expect.poll(() => page.evaluate(async () => Number(await DB.getSetting('lastBackupAt')) > 0)).toBe(true);
});

test('crea e conserva una categoria personalizzata dalle impostazioni', async ({ page }) => {
  await page.getByRole('button', { name: 'Impostazioni' }).click();
  await page.getByRole('textbox', { name: 'Nome nuova categoria' }).fill('Ricette veloci');
  await page.getByRole('textbox', { name: 'Emoji nuova categoria' }).fill('⚡');
  await page.getByRole('button', { name: 'Aggiungi', exact: true }).click();

  await expect(page.getByRole('button', { name: 'Elimina categoria Ricette veloci' })).toBeVisible();
  await expect.poll(() => page.evaluate(async () => {
    const stored = await DB.getSetting('customCategories');
    return DB._parseCustomCategories(stored).some(category => category.label === 'Ricette veloci');
  })).toBe(true);
});

test('mantiene modificabili le unità personalizzate provenienti dai backup', async ({ page }) => {
  const recipeId = await page.evaluate(() => DB.addRecipe({
    name: 'Unità dal backup',
    category: 'altro',
    description: '',
    ingredients: [{ name: 'Yogurt', quantity: '2', unit: 'vasetti', notes: '' }],
    steps: [{ text: 'Mescolare.', notes: '' }],
    prepTime: 5,
    cookTime: 0,
    servings: 2,
    difficulty: 'facile',
    notes: '',
    storage: '',
    image: null,
    imageThumbnail: null,
    isFavorite: false
  }));

  await page.goto('/index.html?e2e=1#edit/' + encodeURIComponent(recipeId));
  const warningButton = page.getByRole('button', { name: 'Ho capito' });
  if (await warningButton.isVisible().catch(() => false)) await warningButton.click();
  await page.getByRole('tab', { name: 'Ingredienti e preparazione' }).click();
  const unitSelect = page.getByRole('combobox', { name: 'Unità ingrediente 1' });
  await expect(unitSelect).toHaveValue('vasetti');
  await expect(unitSelect.locator('option:checked')).toHaveText('vasetti (dal backup)');
  await page.getByRole('tab', { name: 'Dettagli di cottura' }).click();
  await page.getByRole('button', { name: /Salva modifiche/ }).click();

  await expect.poll(() => page.evaluate(id => DB.getRecipe(id).then(recipe => recipe.ingredients[0].unit), recipeId))
    .toBe('vasetti');
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
    const request = indexedDB.open('SaporiDB');
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
  await expect(page.getByRole('combobox', { name: 'Unità ingrediente 1' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Descrizione passaggio 1' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Rimuovi ingrediente 2' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Rimuovi passaggio 2' })).toBeVisible();
});

test('collega gli errori ai campi e porta il focus sul primo errore', async ({ page }) => {
  await page.getByRole('button', { name: 'Nuova ricetta' }).click();
  await page.getByRole('tab', { name: 'Dettagli di cottura' }).click();
  await page.getByRole('button', { name: 'Salva Ricetta' }).click();

  const nameInput = page.getByRole('textbox', { name: 'Nome ricetta' });
  await expect(nameInput).toBeFocused();
  await expect(nameInput).toHaveAttribute('aria-invalid', 'true');
  await expect(nameInput).toHaveAttribute('aria-describedby', 'error-name');
  await expect(page.locator('#error-name')).toContainText('almeno 2 caratteri');
});

test('mantiene il focus durante l’inserimento in Svuotafrigo', async ({ page }) => {
  await page.getByRole('button', { name: /Svuotafrigo/ }).click();
  const pantryInput = page.getByRole('textbox', { name: 'Ingredienti disponibili' });
  await pantryInput.fill('uova');
  await page.getByRole('button', { name: 'Aggiungi', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Ingredienti disponibili' })).toBeFocused();
  await expect(page.getByRole('textbox', { name: 'Ingredienti disponibili' })).toHaveValue('');
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

test('ignora i render obsoleti e consente di riprovare dopo un errore', async ({ page }) => {
  await page.evaluate(() => {
    window.__originalGetRecipeSummaries = DB.getRecipeSummaries.bind(DB);
    DB.getRecipeSummaries = () => new Promise(resolve => {
      window.__resolveDelayedHome = async () => resolve(await window.__originalGetRecipeSummaries());
    });
  });

  await page.getByRole('button', { name: /Antipasti/ }).click();
  await page.getByRole('button', { name: 'Impostazioni', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Impostazioni' })).toBeVisible();
  await page.evaluate(() => window.__resolveDelayedHome());
  await expect(page.getByRole('heading', { name: 'Impostazioni' })).toBeVisible();

  await page.evaluate(() => {
    DB.getRecipeSummaries = async () => {
      throw new Error('Errore simulato');
    };
  });
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Impossibile caricare questa sezione' })).toBeVisible();

  await page.evaluate(() => {
    DB.getRecipeSummaries = window.__originalGetRecipeSummaries;
  });
  await page.getByRole('button', { name: 'Riprova', exact: true }).click();
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
