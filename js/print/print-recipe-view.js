/**
 * Renderer e flusso della singola ricetta stampabile.
 * Mantiene la composizione PDF separata dalle viste interattive.
 */
(function (global) {
  'use strict';

  /**
   * Build the canonical printable layout used by individual recipes and the
   * complete cookbook. Keeping one template prevents print layout drift.
   * @param {Object} recipe
   * @param {Object} [options]
   * @returns {string}
   */
  function buildPrintableRecipeHTML(recipe, options) {
    options = options || {};
    var esc = global.Utils.escapeHtml;
    var cat = global.Utils.getCategoryInfo(recipe.category);
    var diffEmoji = global.Utils.getDifficultyEmoji(recipe.difficulty);
    var diffMap = { facile: 'Facile', media: 'Media', difficile: 'Difficile' };
    var totalMinutes = (parseInt(recipe.prepTime, 10) || 0) + (parseInt(recipe.cookTime, 10) || 0);
    var recipeNumber = options.recipeNumber
      ? '<span class="print-recipe-sheet__number">Ricetta ' + esc(String(options.recipeNumber).padStart(2, '0')) + '</span>'
      : '';

    var ingredientsHtml = '';
    if (recipe.ingredients && recipe.ingredients.length) {
      recipe.ingredients.forEach(function (ingredient) {
        var quantity = ingredient.quantity
          ? esc(ingredient.quantity) + (ingredient.unit ? ' ' + esc(ingredient.unit) : '')
          : '';
        ingredientsHtml +=
          '<li class="print-recipe-sheet__ingredient">' +
            '<span class="print-recipe-sheet__bullet" aria-hidden="true"></span>' +
            '<div class="print-recipe-sheet__ingredient-content">' +
              '<div class="print-recipe-sheet__ingredient-main">' +
                '<span class="print-recipe-sheet__ingredient-name">' + esc(ingredient.name) + '</span>' +
                (quantity ? '<strong class="print-recipe-sheet__quantity">' + quantity + '</strong>' : '') +
              '</div>' +
              (ingredient.notes
                ? '<span class="print-recipe-sheet__ingredient-note">' + esc(ingredient.notes) + '</span>'
                : '') +
            '</div>' +
          '</li>';
      });
    } else {
      ingredientsHtml = '<li class="print-recipe-sheet__empty">Nessun ingrediente inserito.</li>';
    }

    var stepsHtml = '';
    if (recipe.steps && recipe.steps.length) {
      recipe.steps.forEach(function (step, index) {
        var stepText = typeof step === 'object' ? step.text : step;
        var stepNotes = typeof step === 'object' ? step.notes : '';
        stepsHtml +=
          '<li class="print-recipe-sheet__step">' +
            '<span class="print-recipe-sheet__step-number">' + (index + 1) + '</span>' +
            '<div class="print-recipe-sheet__step-content">' +
              '<p>' + esc(stepText) + '</p>' +
              (stepNotes
                ? '<span class="print-recipe-sheet__step-note">Suggerimento: ' + esc(stepNotes) + '</span>'
                : '') +
            '</div>' +
          '</li>';
      });
    } else {
      stepsHtml = '<li class="print-recipe-sheet__empty">Nessun passaggio inserito.</li>';
    }

    var notesHtml = recipe.notes
      ? '<p class="print-recipe-sheet__notes-text">' + esc(recipe.notes) + '</p>'
      : '<div class="print-recipe-sheet__writing-lines" aria-label="Spazio per annotazioni"><span></span><span></span><span></span></div>';
    var storageHtml = recipe.storage
      ? '<section class="print-recipe-sheet__storage"><h2>Conservazione</h2><p class="print-recipe-sheet__notes-text">' + esc(recipe.storage) + '</p></section>'
      : '';
    var photoHtml = recipe.image
      ? '<figure class="print-recipe-sheet__photo"><img src="' + esc(recipe.image) + '" alt="Foto di ' + esc(recipe.name) + '"></figure>'
      : '';

    return (
      '<article class="print-recipe-sheet">' +
        '<div class="print-recipe-sheet__accent" aria-hidden="true"></div>' +
        '<header class="print-recipe-sheet__header">' +
          '<div class="print-recipe-sheet__brand-row">' +
            '<span class="print-recipe-sheet__brand">🍴 Sapori</span>' +
            recipeNumber +
          '</div>' +
          '<div class="print-recipe-sheet__intro' + (photoHtml ? ' print-recipe-sheet__intro--with-photo' : '') + '">' +
            '<div class="print-recipe-sheet__intro-copy">' +
              '<span class="print-recipe-sheet__category">' + esc(cat.icon) + ' ' + esc(cat.label) + '</span>' +
              '<h1 class="print-recipe-sheet__title">' + esc(recipe.name) + '</h1>' +
              (recipe.description ? '<p class="print-recipe-sheet__description">' + esc(recipe.description) + '</p>' : '') +
            '</div>' +
            photoHtml +
          '</div>' +
        '</header>' +
        '<dl class="print-recipe-sheet__meta">' +
          '<div><dt>Preparazione</dt><dd>' + esc(global.Utils.formatTime(recipe.prepTime || 0)) + '</dd></div>' +
          '<div><dt>Cottura</dt><dd>' + esc(global.Utils.formatTime(recipe.cookTime || 0)) + '</dd></div>' +
          '<div><dt>Tempo totale</dt><dd>' + esc(global.Utils.formatTime(totalMinutes)) + '</dd></div>' +
          '<div><dt>Porzioni</dt><dd>' + esc(String(recipe.servings || 4)) + '</dd></div>' +
          '<div><dt>Difficoltà</dt><dd>' + esc(diffEmoji) + ' ' + esc(diffMap[recipe.difficulty] || 'Media') + '</dd></div>' +
        '</dl>' +
        '<section class="print-recipe-sheet__section">' +
          '<h2>Ingredienti</h2>' +
          '<ul class="print-recipe-sheet__ingredients">' + ingredientsHtml + '</ul>' +
        '</section>' +
        '<section class="print-recipe-sheet__section print-recipe-sheet__section--steps">' +
          '<h2>Preparazione</h2>' +
          '<ol class="print-recipe-sheet__steps">' + stepsHtml + '</ol>' +
        '</section>' +
        '<div class="print-recipe-sheet__aftercare' + (storageHtml ? '' : ' print-recipe-sheet__aftercare--single') + '">' +
          '<section class="print-recipe-sheet__notes">' +
            '<h2>Note</h2>' + notesHtml +
          '</section>' +
          storageHtml +
        '</div>' +
      '</article>'
    );
  }

  /**
   * Build the printable document and open the browser print dialog directly.
   * @param {Object} recipe
   * @returns {Promise<void>}
   */
  async function printRecipePDF(recipe) {
    var printRoot = global.document.createElement('div');
    printRoot.className = 'print-document-root print-document-root--recipe';
    printRoot.innerHTML = buildPrintableRecipeHTML(recipe);
    global.document.body.appendChild(printRoot);

    try {
      var result = await global.PrintService.printDocument(printRoot, {
        bodyClass: 'printing-recipe',
        title: String(recipe.name || 'Ricetta') + ' — Sapori',
        imageConcurrency: 2
      });
      if (result.completion.source === 'safety-timeout') {
        global.Utils.showToast(
          'La stampa non ha comunicato la chiusura: l’app è stata ripristinata in sicurezza.',
          'warning'
        );
      }
    } catch (error) {
      console.error('Errore durante la stampa della ricetta:', error);
      global.Utils.showToast('Impossibile preparare la stampa', 'error');
    }
  }

  global.PrintRecipeView = {
    buildHTML: buildPrintableRecipeHTML,
    print: printRecipePDF
  };
})(typeof window !== 'undefined' ? window : globalThis);
