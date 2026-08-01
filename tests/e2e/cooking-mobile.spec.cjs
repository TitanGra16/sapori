const { test, expect } = require('@playwright/test');

const APP_PATH = '/index.html?cooking-mobile-e2e=1';

async function bootApp(page) {
  await page.addInitScript(() => {
    localStorage.setItem('sapori-warning-dismissed', 'true');
  });
  await page.goto(APP_PATH);
}

async function seedLongRecipe(page) {
  return page.evaluate(async () => DB.addRecipe({
    name: 'Preparazione leggibile su smartphone',
    category: 'primi',
    description: '',
    ingredients: Array.from({ length: 12 }, (_, index) => ({
      name: index === 0
        ? 'IngredienteConUnNomeMoltoLungoSenzaSpaziDaNonTagliare'
        : 'Ingrediente dettagliato numero ' + (index + 1),
      quantity: String(index + 1),
      unit: 'cucchiai',
      notes: ''
    })),
    steps: Array.from({ length: 20 }, (_, index) => ({
      text: index === 0
        ? 'MescolareConGrandeAttenzioneTuttiGliIngredientiSenzaInterrompereLaPreparazione e proseguire finché il composto risulta uniforme e facile da lavorare.'
        : 'Passaggio ' + (index + 1) + ': continuare la preparazione con cura.',
      notes: index === 0
        ? 'ControllareCheLaConsistenzaRimangaMorbidaSenzaFormareGrumi e regolare lentamente la lavorazione.'
        : ''
    })),
    prepTime: 20,
    cookTime: 35,
    servings: 4,
    difficulty: 'media',
    notes: '',
    storage: '',
    image: null,
    imageThumbnail: null,
    isFavorite: false
  }));
}

async function openCookingMode(page, recipeId) {
  await page.goto(
    APP_PATH + '#detail/' + encodeURIComponent(recipeId)
  );
  await page.getByRole('button', { name: /Modalità cucina/ }).click();
  await expect(page.locator('.cooking-modal')).toBeVisible();
  await page.waitForTimeout(450);
}

test('passaggi e note restano leggibili e scrollabili tra 360 e 430 px', async ({
  page
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium-desktop',
    'Il test attraversa già tutte le larghezze mobile in un solo progetto.'
  );

  await bootApp(page);
  const recipeId = await seedLongRecipe(page);

  for (const width of [360, 390, 430]) {
    await page.setViewportSize({ width, height: 780 });
    await openCookingMode(page, recipeId);

    const metrics = await page.evaluate(() => {
      const rect = selector => document.querySelector(selector);
      const modal = rect('.cooking-modal');
      const body = rect('.cooking-modal__body');
      const card = rect('.cooking-modal__step-card');
      const text = rect('.cooking-modal__step-text');
      const notes = rect('.cooking-modal__step-notes');
      const ingredients = rect('.cooking-modal__ing-panel');
      const dots = rect('.cooking-modal__dots');
      const close = rect('.cooking-modal__close');
      const timer = rect('.cooking-modal__timer');
      const headerLeft = rect('.cooking-modal__header-left');
      const headerRight = rect('.cooking-modal__header-right');
      const textStyle = getComputedStyle(text);
      const notesStyle = getComputedStyle(notes);
      const chipStyle = getComputedStyle(rect('.cooking-modal__ing-chip'));
      const cardStyle = getComputedStyle(card);
      const parseColor = value => {
        const channels = String(value).match(/[\d.]+/g).map(Number);
        return {
          red: channels[0],
          green: channels[1],
          blue: channels[2],
          alpha: channels.length > 3 ? channels[3] : 1
        };
      };
      const composite = (foreground, background) => ({
        red: foreground.red * foreground.alpha + background.red * (1 - foreground.alpha),
        green: foreground.green * foreground.alpha + background.green * (1 - foreground.alpha),
        blue: foreground.blue * foreground.alpha + background.blue * (1 - foreground.alpha),
        alpha: 1
      });
      const luminance = color => {
        const channel = value => {
          const normalized = value / 255;
          return normalized <= 0.03928
            ? normalized / 12.92
            : Math.pow((normalized + 0.055) / 1.055, 2.4);
        };
        return 0.2126 * channel(color.red) +
          0.7152 * channel(color.green) +
          0.0722 * channel(color.blue);
      };
      const contrast = (first, second) => {
        const firstLum = luminance(first);
        const secondLum = luminance(second);
        return (Math.max(firstLum, secondLum) + 0.05) /
          (Math.min(firstLum, secondLum) + 0.05);
      };
      const cardBackground = parseColor(cardStyle.backgroundColor);
      const noteBackground = composite(
        parseColor(notesStyle.backgroundColor),
        cardBackground
      );

      return {
        modalLeft: modal.getBoundingClientRect().left,
        modalRight: modal.getBoundingClientRect().right,
        closeRight: close.getBoundingClientRect().right,
        bodyClientHeight: body.clientHeight,
        bodyScrollHeight: body.scrollHeight,
        cardClientHeight: card.clientHeight,
        cardScrollHeight: card.scrollHeight,
        ingredientsClientHeight: ingredients.clientHeight,
        ingredientsScrollHeight: ingredients.scrollHeight,
        textClientWidth: text.clientWidth,
        textScrollWidth: text.scrollWidth,
        notesClientWidth: notes.clientWidth,
        notesScrollWidth: notes.scrollWidth,
        dotsHeight: dots.getBoundingClientRect().height,
        dotsClientWidth: dots.clientWidth,
        dotsScrollWidth: dots.scrollWidth,
        timerHeight: timer.getBoundingClientRect().height,
        headerLeftRight: headerLeft.getBoundingClientRect().right,
        headerRightLeft: headerRight.getBoundingClientRect().left,
        textFontSize: parseFloat(textStyle.fontSize),
        notesFontSize: parseFloat(notesStyle.fontSize),
        notesLineHeight: parseFloat(notesStyle.lineHeight),
        chipFontSize: parseFloat(chipStyle.fontSize),
        stepContrast: contrast(
          parseColor(textStyle.color),
          cardBackground
        ),
        notesContrast: contrast(
          parseColor(notesStyle.color),
          noteBackground
        )
      };
    });

    expect(metrics.modalLeft, width + 'px: bordo sinistro').toBeGreaterThanOrEqual(-1);
    expect(metrics.modalRight, width + 'px: bordo destro').toBeLessThanOrEqual(width + 1);
    expect(metrics.closeRight, width + 'px: pulsante chiudi').toBeLessThanOrEqual(width);
    expect(metrics.cardScrollHeight, width + 'px: passaggio tagliato')
      .toBeLessThanOrEqual(metrics.cardClientHeight + 1);
    expect(metrics.ingredientsScrollHeight, width + 'px: ingredienti tagliati')
      .toBeLessThanOrEqual(metrics.ingredientsClientHeight + 1);
    expect(metrics.textScrollWidth, width + 'px: testo senza a capo')
      .toBeLessThanOrEqual(metrics.textClientWidth + 1);
    expect(metrics.notesScrollWidth, width + 'px: nota senza a capo')
      .toBeLessThanOrEqual(metrics.notesClientWidth + 1);
    expect(metrics.bodyScrollHeight, width + 'px: corpo non scrollabile')
      .toBeGreaterThan(metrics.bodyClientHeight);
    expect(metrics.dotsHeight, width + 'px: mappa passaggi troppo alta')
      .toBeLessThanOrEqual(64);
    expect(metrics.dotsScrollWidth, width + 'px: mappa non orizzontale')
      .toBeGreaterThan(metrics.dotsClientWidth);
    expect(metrics.timerHeight, width + 'px: timer troppo alto')
      .toBeLessThanOrEqual(130);
    expect(metrics.headerLeftRight, width + 'px: header sovrapposto')
      .toBeLessThanOrEqual(metrics.headerRightLeft + 1);
    expect(metrics.textFontSize, width + 'px: testo passaggio')
      .toBeGreaterThanOrEqual(19);
    expect(metrics.notesFontSize, width + 'px: testo nota')
      .toBeGreaterThanOrEqual(16);
    expect(metrics.notesLineHeight, width + 'px: interlinea nota')
      .toBeGreaterThanOrEqual(24);
    expect(metrics.chipFontSize, width + 'px: testo ingredienti')
      .toBeGreaterThanOrEqual(14);
    expect(metrics.stepContrast, width + 'px: contrasto passaggio')
      .toBeGreaterThanOrEqual(4.5);
    expect(metrics.notesContrast, width + 'px: contrasto nota')
      .toBeGreaterThanOrEqual(4.5);

    await page.getByRole('button', { name: 'Vai al passaggio 20' }).click();
    await expect(page.locator('.cooking-modal__dot--active')).toHaveText('20');
    const activeDotBounds = await page.evaluate(() => {
      const strip = document.querySelector('.cooking-modal__dots')
        .getBoundingClientRect();
      const active = document.querySelector('.cooking-modal__dot--active')
        .getBoundingClientRect();
      return {
        stripLeft: strip.left,
        stripRight: strip.right,
        activeLeft: active.left,
        activeRight: active.right
      };
    });
    expect(activeDotBounds.activeLeft, width + 'px: punto attivo a sinistra')
      .toBeGreaterThanOrEqual(activeDotBounds.stripLeft - 1);
    expect(activeDotBounds.activeRight, width + 'px: punto attivo a destra')
      .toBeLessThanOrEqual(activeDotBounds.stripRight + 1);

    await page.getByRole('button', { name: 'Chiudi modalità cucina' }).click();
  }
});
