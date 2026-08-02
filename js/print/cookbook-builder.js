/**
 * Costruisce il ricettario stampabile senza bloccare a lungo il thread UI.
 * Il modulo riceve le dipendenze di dominio dall'esterno e resta indipendente
 * dal controller principale dell'app.
 */
(function (global) {
  'use strict';

  function requireFunction(value, message) {
    if (typeof value !== 'function') throw new Error(message);
    return value;
  }

  function appendTextElement(documentRef, parent, tagName, className, text) {
    var element = documentRef.createElement(tagName);
    element.className = className;
    element.textContent = text;
    parent.appendChild(element);
    return element;
  }

  function buildCover(documentRef, count) {
    var cover = documentRef.createElement('section');
    cover.className = 'print-cover-page';
    appendTextElement(documentRef, cover, 'div', 'print-cover-brand', '🍴 SAPORI');
    appendTextElement(documentRef, cover, 'div', 'print-cover-emoji', '📖');
    appendTextElement(documentRef, cover, 'div', 'print-cover-title', 'Il mio ricettario');
    var divider = documentRef.createElement('div');
    divider.className = 'print-cover-divider';
    divider.setAttribute('aria-hidden', 'true');
    cover.appendChild(divider);
    appendTextElement(
      documentRef,
      cover,
      'div',
      'print-cover-subtitle',
      count + (count === 1 ? ' ricetta della tradizione di casa' : ' ricette della tradizione di casa')
    );
    return cover;
  }

  function buildIndexShell(documentRef) {
    var section = documentRef.createElement('section');
    section.className = 'print-index-page';
    appendTextElement(documentRef, section, 'div', 'print-index-kicker', 'Il mio ricettario');
    appendTextElement(documentRef, section, 'h1', 'print-index-title', 'Indice delle ricette');
    appendTextElement(
      documentRef,
      section,
      'p',
      'print-index-summary',
      'Le ricette sono numerate nello stesso ordine delle schede successive.'
    );
    var list = documentRef.createElement('ol');
    list.className = 'print-index-list';
    section.appendChild(list);
    return { section: section, list: list };
  }

  async function build(recipes, options) {
    options = options || {};
    if (!Array.isArray(recipes)) {
      throw new Error('Il ricettario richiede un elenco di ricette');
    }
    if (!global.PrintService || typeof global.PrintService.buildInBatches !== 'function') {
      throw new Error('Servizio di stampa non disponibile');
    }

    var documentRef = options.document || global.document;
    if (!documentRef || typeof documentRef.createElement !== 'function') {
      throw new Error('Documento non disponibile');
    }
    var buildRecipeHTML = requireFunction(
      options.buildRecipeHTML,
      'Renderer della ricetta stampabile non disponibile'
    );
    var getCategoryInfo = requireFunction(
      options.getCategoryInfo,
      'Catalogo categorie non disponibile'
    );
    var onProgress = typeof options.onProgress === 'function'
      ? options.onProgress
      : null;
    var signal = options.signal;
    var batchSize = Number.isInteger(Number(options.batchSize))
      ? Math.max(1, Math.min(100, Number(options.batchSize)))
      : 25;
    var sortedRecipes = recipes.slice().sort(function (first, second) {
      return String(first.name || '').localeCompare(String(second.name || ''), 'it-IT');
    });

    var root = documentRef.createElement('div');
    root.className = 'print-document-root print-document-root--cookbook print-all-recipes-container';
    root.appendChild(buildCover(documentRef, sortedRecipes.length));
    var index = buildIndexShell(documentRef);
    root.appendChild(index.section);

    await global.PrintService.buildInBatches(
      index.list,
      sortedRecipes,
      function (recipe, recipeIndex) {
        var category = getCategoryInfo(recipe.category);
        var item = documentRef.createElement('li');
        item.className = 'print-index-item';
        appendTextElement(
          documentRef,
          item,
          'span',
          'print-index-item-number',
          String(recipeIndex + 1).padStart(2, '0')
        );
        appendTextElement(
          documentRef,
          item,
          'span',
          'print-index-item-name',
          String(recipe.name || 'Ricetta senza nome')
        );
        appendTextElement(
          documentRef,
          item,
          'span',
          'print-index-item-cat',
          String(category && category.label ? category.label : 'Altro')
        );
        return item;
      },
      {
        batchSize: Math.max(batchSize, 40),
        signal: signal,
        window: options.window,
        onProgress: function (progress) {
          if (!onProgress) return;
          return onProgress({
            phase: 'index',
            completed: progress.completed,
            total: progress.total,
            percent: progress.percent
          });
        }
      }
    );

    await global.PrintService.buildInBatches(
      root,
      sortedRecipes,
      function (recipe, recipeIndex) {
        var wrapper = documentRef.createElement('div');
        wrapper.className = 'print-cookbook-recipe';
        wrapper.innerHTML = buildRecipeHTML(recipe, {
          recipeNumber: recipeIndex + 1
        });
        return wrapper;
      },
      {
        batchSize: batchSize,
        signal: signal,
        window: options.window,
        onProgress: function (progress) {
          if (!onProgress) return;
          return onProgress({
            phase: 'recipes',
            completed: progress.completed,
            total: progress.total,
            percent: progress.percent
          });
        }
      }
    );

    return root;
  }

  global.CookbookBuilder = {
    build: build
  };
})(typeof window !== 'undefined' ? window : globalThis);
