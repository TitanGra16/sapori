const { test, expect } = require('@playwright/test');

const LOCAL_PATH = 'file:///C:/Users/utente/Desktop/sapori/index.html';

async function openCleanApp(page) {
  await page.addInitScript(() => {
    localStorage.setItem('sapori-warning-dismissed', 'true');
  });
  await page.goto('/index.html?print-cleanliness-e2e=1');
}

function printableRecipe() {
  return {
    name: 'Ricetta pulita',
    category: 'altro',
    description: 'Documento senza informazioni tecniche del dispositivo.',
    ingredients: [{ name: 'Farina', quantity: '100', unit: 'g', notes: '' }],
    steps: [{ text: 'Impasta con cura.', notes: '' }],
    prepTime: 10,
    cookTime: 20,
    servings: 4,
    difficulty: 'facile',
    notes: 'Annotazione utile.',
    storage: 'Conservare in frigorifero.',
    image: null
  };
}

test.beforeEach(async ({ page }) => {
  await openCleanApp(page);
});

test('non inserisce data o percorso locale nella ricetta stampabile', async ({ page }) => {
  const result = await page.evaluate(({ recipe, localPath }) => {
    const container = document.createElement('div');
    container.innerHTML = Views.buildPrintableRecipeHTML(recipe, {
      printedOn: '2 agosto 2026',
      appUrl: localPath
    });
    return {
      text: container.textContent,
      footers: container.querySelectorAll('.print-recipe-sheet__footer').length
    };
  }, { recipe: printableRecipe(), localPath: LOCAL_PATH });

  expect(result.footers).toBe(0);
  expect(result.text).not.toContain('Stampato il');
  expect(result.text).not.toContain('2 agosto 2026');
  expect(result.text).not.toContain('file:///');
  expect(result.text).not.toContain('C:/Users/');
});

test('non ripete metadati tecnici nella copertina o nel ricettario', async ({ page }) => {
  const result = await page.evaluate(async ({ recipe, localPath }) => {
    const root = await CookbookBuilder.build([recipe], {
      buildRecipeHTML: Views.buildPrintableRecipeHTML,
      getCategoryInfo: Utils.getCategoryInfo,
      printedOn: '2 agosto 2026',
      appUrl: localPath,
      batchSize: 1
    });
    const snapshot = {
      text: root.textContent,
      coverMetadata: root.querySelectorAll('.print-cover-meta').length,
      recipeFooters: root.querySelectorAll('.print-recipe-sheet__footer').length
    };
    root.remove();
    return snapshot;
  }, { recipe: printableRecipe(), localPath: LOCAL_PATH });

  expect(result.coverMetadata).toBe(0);
  expect(result.recipeFooters).toBe(0);
  expect(result.text).not.toContain('Stampato il');
  expect(result.text).not.toContain('Esportato il');
  expect(result.text).not.toContain('2 agosto 2026');
  expect(result.text).not.toContain('file:///');
  expect(result.text).not.toContain('C:/Users/');
});

test('usa un layout frammentabile per non perdere righe nei PDF lunghi', async ({ page }) => {
  await page.emulateMedia({ media: 'print' });
  const result = await page.evaluate(recipe => {
    const longRecipe = {
      ...recipe,
      ingredients: Array.from({ length: 40 }, (_, index) => ({
        name: 'Ingrediente numero ' + (index + 1),
        quantity: String(index + 1),
        unit: 'g',
        notes: ''
      })),
      steps: Array.from({ length: 60 }, (_, index) => ({
        text: 'Passaggio numero ' + (index + 1),
        notes: ''
      }))
    };
    const root = document.createElement('div');
    root.className = 'print-document-root print-document-root--cookbook';
    root.innerHTML = '<div class="print-cookbook-recipe">' +
      Views.buildPrintableRecipeHTML(longRecipe, { recipeNumber: 1 }) +
      '</div>';
    document.body.appendChild(root);
    document.body.classList.add('printing-all-recipes');
    const sheet = root.querySelector('.print-recipe-sheet');
    const snapshot = {
      display: getComputedStyle(sheet).display,
      ingredients: sheet.querySelectorAll('.print-recipe-sheet__ingredient').length,
      steps: sheet.querySelectorAll('.print-recipe-sheet__step').length
    };
    root.remove();
    document.body.classList.remove('printing-all-recipes');
    return snapshot;
  }, printableRecipe());

  expect(result).toEqual({
    display: 'block',
    ingredients: 40,
    steps: 60
  });
});
