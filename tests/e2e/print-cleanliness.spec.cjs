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
