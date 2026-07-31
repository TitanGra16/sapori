/**
 * Sapori — Views Module
 * Renders all application views into the DOM.
 * Every user-provided string is escaped via Utils.escapeHtml() to prevent XSS.
 */
window.Views = (function () {
  'use strict';

  /* ──────────────────── HELPERS ──────────────────── */

  function categoryStyle(category) {
    var color = Utils.escapeHtml(category.color);
    return 'background:' + color + ';color:' + Utils.getContrastText(category.color);
  }

  function recipeCardHTML(recipe, index) {
    const esc = Utils.escapeHtml;
    const cat = Utils.getCategoryInfo(recipe.category);
    const totalTime = Utils.getTotalTime(recipe.prepTime, recipe.cookTime);
    const diffEmoji = Utils.getDifficultyEmoji(recipe.difficulty);
    const stagger = (index % 8) + 1;
    const favClass = recipe.isFavorite ? 'is-favorite' : '';

    let imageBlock;
    if (recipe.image) {
      imageBlock = '<div class="recipe-card__image"><img src="' + esc(recipe.image) + '" alt="' + esc(recipe.name) + '" loading="lazy"></div>';
    } else {
      imageBlock =
        '<div class="recipe-card__placeholder" style="background:' + esc(cat.color) + '">' +
          '<span style="font-size:2.5rem">' + esc(cat.icon) + '</span>' +
        '</div>';
    }

    return (
      '<article class="recipe-card animate-scale-in stagger-' + stagger + '" data-id="' + esc(recipe.id) + '">' +
        '<a class="recipe-card__link" href="#detail/' + esc(encodeURIComponent(recipe.id)) + '" data-action="open-recipe" data-id="' + esc(recipe.id) + '" aria-label="Apri la ricetta ' + esc(recipe.name) + '">' +
          imageBlock +
          '<div class="recipe-card__content">' +
            '<h3 class="recipe-card__title">' + esc(recipe.name) + '</h3>' +
            '<div class="recipe-card__meta">' +
              '<span class="recipe-card__meta-item">⏱️ ' + esc(totalTime) + '</span>' +
              '<span class="recipe-card__meta-item">' + esc(diffEmoji) + '</span>' +
            '</div>' +
            '<span class="recipe-card__category" style="' + categoryStyle(cat) + '">' +
              esc(cat.icon) + ' ' + esc(cat.label) +
            '</span>' +
          '</div>' +
        '</a>' +
        '<button type="button" class="recipe-card__favorite ' + favClass + '" data-action="toggle-fav" data-id="' + esc(recipe.id) + '" aria-label="' + (recipe.isFavorite ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti') + '" aria-pressed="' + recipe.isFavorite + '">' +
          (recipe.isFavorite ? Icons.heartFilled : Icons.heartOutline) +
        '</button>' +
      '</article>'
    );
  }

  function recipeGridHTML(recipes) {
    if (!recipes || recipes.length === 0) return '';
    return '<div class="recipe-grid">' + recipes.map(function (r, i) { return recipeCardHTML(r, i); }).join('') + '</div>';
  }

  function emptyStateHTML(icon, title, description, buttonLabel, buttonAction) {
    var html =
      '<div class="empty-state animate-fade-in">' +
        '<div class="empty-state__icon">' + icon + '</div>' +
        '<h2 class="empty-state__title">' + Utils.escapeHtml(title) + '</h2>' +
        '<p class="empty-state__description">' + Utils.escapeHtml(description) + '</p>';
    if (buttonLabel && buttonAction) {
      html += '<button type="button" class="btn btn--primary" data-action="' + Utils.escapeHtml(buttonAction) + '">' + Utils.escapeHtml(buttonLabel) + '</button>';
    }
    html += '</div>';
    return html;
  }

  function categoryChipsHTML(activeCategory) {
    var esc = Utils.escapeHtml;
    var html = '<div class="filter-bar">';
    html += '<button type="button" class="filter-chip filter-chip--pantry" data-action="go-pantry">' +
              '👨‍🍳 Svuotafrigo</button>';
    html += '<button type="button" class="filter-chip' + (activeCategory === '' ? ' active' : '') + '" data-action="filter-category" data-category="" aria-pressed="' + (activeCategory === '') + '">' +
              '🍽️ Tutte</button>';
    Recipes.CATEGORIES.forEach(function (cat) {
      html += '<button type="button" class="filter-chip' + (activeCategory === cat.id ? ' active' : '') + '" data-action="filter-category" data-category="' + esc(cat.id) + '" aria-pressed="' + (activeCategory === cat.id) + '">' +
                esc(cat.icon) + ' ' + esc(cat.label) +
              '</button>';
    });
    html += '</div>';
    return html;
  }

  function sortBarHTML(currentSort) {
    var esc = Utils.escapeHtml;
    var options = [
      { value: 'recent', label: 'Più recenti' },
      { value: 'oldest', label: 'Meno recenti' },
      { value: 'name-az', label: 'Nome A-Z' },
      { value: 'name-za', label: 'Nome Z-A' },
      { value: 'time-asc', label: 'Tempo ↑' },
      { value: 'time-desc', label: 'Tempo ↓' }
    ];
    var html = '<div class="sort-select"><select id="sort-select" data-action="sort-change" aria-label="Ordina ricette">';
    options.forEach(function (opt) {
      html += '<option value="' + esc(opt.value) + '"' + (currentSort === opt.value ? ' selected' : '') + '>' + esc(opt.label) + '</option>';
    });
    html += '</select></div>';
    return html;
  }

  /* ──────────────────── HOME VIEW ──────────────────── */

  async function renderHome(container, filters) {
    filters = filters || { search: '', category: '', sortBy: 'recent' };

    var draftRecordsPromise = DraftStore.list().then(
      function (records) {
        return { records: records, error: null };
      },
      function (error) {
        return { records: [], error: error };
      }
    );
    var recipes = await DB.getRecipeSummaries();
    var draftResult = await draftRecordsPromise;
    if (draftResult.error) {
      console.warn(
        'Impossibile leggere il riepilogo delle bozze:',
        draftResult.error
      );
    }
    var draftItems = DraftCatalog.describe(draftResult.records, recipes);

    var sortMap = {
      'recent': 'recent',
      'oldest': 'oldest',
      'name-az': 'name_asc',
      'name-za': 'name_desc',
      'time-asc': 'time_asc',
      'time-desc': 'time_desc'
    };

    var filtered = Recipes.filterRecipes(recipes, {
      search: filters.search,
      category: filters.category,
      sortBy: sortMap[filters.sortBy] || 'recent'
    });

    var html = '<div class="view home-view animate-fade-in">';
    html += '<h1 class="sr-only">Le mie ricette</h1>';
    html += DraftCatalog.homeSummaryHTML(draftItems);
    html += '<div class="home-toolbar">';
    html += categoryChipsHTML(filters.category);
    html += sortBarHTML(filters.sortBy);
    html += '</div>';

    if (filtered.length > 0) {
      html += recipeGridHTML(filtered);
    } else if (recipes.length === 0) {
      html += draftItems.length > 0
        ? emptyStateHTML(
            Icons.bookOpen,
            'Nessuna ricetta completata',
            'Puoi riprendere una bozza oppure iniziare una nuova ricetta.',
            'Riprendi una bozza',
            'open-drafts'
          )
        : emptyStateHTML(
            Icons.bookOpen,
            'Il tuo ricettario è vuoto',
            'Crea la prima ricetta e ritrovala qui, sempre ordinata.',
            'Crea la prima ricetta',
            'go-create'
          );
    } else {
      html += emptyStateHTML(Icons.searchLg, 'Nessuna ricetta trovata', 'Prova a cambiare ricerca, categoria o ordinamento.', null, null);
    }

    html += '</div>';
    container.innerHTML = html;
  }

  /* ──────────────────── CREATE / EDIT VIEW ──────────────────── */

  function renderCreate(container, recipe, options) {
    options = options || {};
    var isEdit = options.mode ? options.mode === 'edit' : !!recipe;
    var sourceRecipe = recipe || Recipes.createEmptyRecipe();
    var r = Object.assign({}, sourceRecipe, {
      ingredients: Array.isArray(sourceRecipe.ingredients)
        ? sourceRecipe.ingredients.slice()
        : [],
      steps: Array.isArray(sourceRecipe.steps) ? sourceRecipe.steps.slice() : []
    });
    var esc = Utils.escapeHtml;

    var title = isEdit ? 'Modifica Ricetta' : 'Nuova Ricetta';

    // Ensure at least 1 ingredient row
    if (!r.ingredients || r.ingredients.length === 0) {
      r.ingredients = [{ name: '', quantity: '', unit: '' }];
    }
    // Ensure at least 1 step
    if (!r.steps || r.steps.length === 0) {
      r.steps = [''];
    }

    var html = '<div class="view form-view animate-fade-in">';
    html += '<div class="view-header view-header--back">';
    html += '<button type="button" class="btn btn--icon view-back-button" data-action="cancel-form" aria-label="Annulla e torna indietro">' + Icons.arrowLeft + '</button>';
    html += '<h1 class="view-header__title">' + esc(title) + '</h1></div>';
    html += '<div class="recipe-editor">';

    if (options.draftRestoreError) {
      html +=
        '<div class="draft-recovery-banner draft-recovery-banner--error" role="alert">' +
          '<div class="draft-recovery-banner__copy">' +
            '<strong>Bozza non recuperata</strong>' +
            '<p id="draft-recovery-message">' +
              (options.unreadableDraftRecord
                ? 'Il contenuto salvato non è leggibile. La modifica del modulo è sospesa per non sovrascrivere la bozza originale.'
                : 'L’archivio locale non ha risposto. La modifica del modulo è sospesa finché non riprovi o scegli una copia pulita.') +
            '</p>' +
          '</div>' +
          '<div class="draft-recovery-banner__actions">' +
            '<button type="button" class="btn btn--secondary btn--small" data-action="retry-draft-restore">' +
              'Riprova recupero' +
            '</button>' +
            '<button type="button" class="btn btn--ghost btn--small" data-action="continue-without-draft">' +
              (options.unreadableDraftRecord
                ? 'Continua in una copia pulita'
                : 'Continua senza recupero') +
            '</button>' +
            (options.unreadableDraftRecord
              ? '<button type="button" class="btn btn--ghost btn--small" data-action="discard-draft">' +
                  'Elimina bozza illeggibile' +
                '</button>'
              : '') +
          '</div>' +
        '</div>';
    }

    if (options.draftRecovered) {
      var recoveredAt = Number(options.draftUpdatedAt);
      var recoveredText = Number.isFinite(recoveredAt)
        ? new Date(recoveredAt).toLocaleString('it-IT', {
            day: '2-digit',
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
          })
        : 'dall’ultima sessione';
      html +=
        '<div class="draft-recovery-banner" role="status">' +
          '<div class="draft-recovery-banner__copy">' +
            '<strong>Bozza recuperata</strong>' +
            '<p>Ho ripristinato le modifiche salvate ' + esc(recoveredText) +
              (options.draftConflict
                ? '. La ricetta originale è cambiata nel frattempo: controlla i dati prima di salvare.'
                : '.') +
            '</p>' +
          '</div>' +
          '<button type="button" class="btn btn--ghost btn--small" data-action="discard-draft">' +
            (isEdit ? 'Ripristina versione salvata' : 'Scarta bozza') +
          '</button>' +
        '</div>';
    }

    var initialDraftStatus = options.draftRestoreError
      ? 'error'
      : (options.draftRecovered ? 'recovered' : 'empty');
    var initialDraftMessage = options.draftRestoreError
      ? 'Il recupero della bozza non è riuscito. Riprova prima di continuare.'
      : (options.draftRecovered
          ? 'Bozza recuperata. Le prossime modifiche saranno salvate automaticamente.'
          : 'Le modifiche vengono salvate automaticamente su questo dispositivo.');
    html +=
      '<div class="draft-save-status" id="draft-save-status" data-status="' +
        initialDraftStatus +
        '" role="status" aria-live="polite" aria-atomic="true">' +
        initialDraftMessage +
      '</div>';
    
    // Step Navigation Header
    html +=
      '<div class="form-steps-nav" role="tablist" aria-label="Sezioni della ricetta">' +
        '<button type="button" id="form-tab-info" role="tab" tabindex="0" aria-selected="true" aria-controls="tab-info" class="form-steps-btn active" data-action="switch-tab" data-target="tab-info" aria-label="Informazioni generali">' +
          '<span class="step-num">1</span>' +
          '<span class="step-lbl">Info</span>' +
        '</button>' +
        '<div class="form-steps-line"></div>' +
        '<button type="button" id="form-tab-prep" role="tab" tabindex="-1" aria-selected="false" aria-controls="tab-prep" class="form-steps-btn" data-action="switch-tab" data-target="tab-prep" aria-label="Ingredienti e preparazione">' +
          '<span class="step-num">2</span>' +
          '<span class="step-lbl">Preparazione</span>' +
        '</button>' +
        '<div class="form-steps-line"></div>' +
        '<button type="button" id="form-tab-cook" role="tab" tabindex="-1" aria-selected="false" aria-controls="tab-cook" class="form-steps-btn" data-action="switch-tab" data-target="tab-cook" aria-label="Dettagli di cottura">' +
          '<span class="step-num">3</span>' +
          '<span class="step-lbl">Cottura</span>' +
        '</button>' +
      '</div>';

    html += '<form id="recipe-form" class="recipe-form' +
      (options.draftRestoreError ? ' recipe-form--recovery-blocked' : '') +
      '" novalidate' +
      (options.draftRestoreError
        ? ' inert aria-describedby="draft-recovery-message"'
        : '') +
      '>';

    // Un ID stabile evita che ogni autosalvataggio generi una ricetta diversa.
    html += '<input type="hidden" id="input-id" value="' +
      esc(r.id || Utils.generateId()) + '">';
    html += '<input type="hidden" id="input-content-version" value="' +
      esc(Number.isSafeInteger(Number(r.contentVersion))
        ? String(Number(r.contentVersion))
        : '0') + '">';

    // ──────────────────── TAB 1: INFO ────────────────────
    html += '<div id="tab-info" class="form-tab active" role="tabpanel" aria-labelledby="form-tab-info" aria-hidden="false">';
    
    // Nome
    html +=
      '<div class="form-group">' +
        '<label class="form-label" for="input-name">Nome ricetta *</label>' +
        '<input type="text" class="form-input" id="input-name" maxlength="' + Recipes.LIMITS.name + '" placeholder="Es. Carbonara" value="' + esc(r.name) + '" required>' +
        '<span class="form-error" id="error-name"></span>' +
      '</div>';

    // Categoria
    html +=
      '<div class="form-group">' +
        '<label class="form-label">Categoria *</label>' +
        '<input type="hidden" id="input-category" value="' + esc(r.category || '') + '" required>' +
        '<div class="category-selector-grid" role="radiogroup" aria-label="Categoria della ricetta">';
    var hasSelectedCategory = Recipes.CATEGORIES.some(function (cat) {
      return r.category === cat.id;
    });
    Recipes.CATEGORIES.forEach(function (cat, index) {
      var activeClass = r.category === cat.id ? ' active' : '';
      var isTabStop = r.category === cat.id || (!hasSelectedCategory && index === 0);
      html +=
        '<button type="button" role="radio" tabindex="' + (isTabStop ? '0' : '-1') + '" aria-checked="' + (r.category === cat.id) + '" class="category-select-btn' + activeClass + '" data-action="select-form-category" data-category="' + esc(cat.id) + '">' +
          '<span class="category-select-btn__icon">' + esc(cat.icon) + '</span>' +
          '<span class="category-select-btn__label">' + esc(cat.label) + '</span>' +
        '</button>';
    });
    html += '</div><span class="form-error" id="error-category"></span></div>';

    // Descrizione
    html +=
      '<div class="form-group">' +
        '<label class="form-label" for="input-description">Descrizione</label>' +
        '<textarea class="form-textarea" id="input-description" maxlength="' + Recipes.LIMITS.description + '" rows="3" placeholder="Una breve descrizione della ricetta...">' + esc(r.description || '') + '</textarea>' +
        '<span class="form-error" id="error-description"></span>' +
      '</div>';

    // Note
    html +=
      '<div class="form-group">' +
        '<label class="form-label" for="input-notes">Note</label>' +
        '<textarea class="form-textarea" id="input-notes" maxlength="' + Recipes.LIMITS.notes + '" rows="3" placeholder="Annotazioni personali, consigli e varianti...">' + esc(r.notes || '') + '</textarea>' +
        '<span class="form-error" id="error-notes"></span>' +
      '</div>';

    html +=
      '<div class="form-group">' +
        '<label class="form-label" for="input-storage">Conservazione</label>' +
        '<textarea class="form-textarea" id="input-storage" maxlength="' + Recipes.LIMITS.storage + '" rows="2" placeholder="Es. In frigorifero per 2 giorni, in contenitore ermetico...">' + esc(r.storage || '') + '</textarea>' +
        '<span class="form-error" id="error-storage"></span>' +
      '</div>';

    // Immagine
    html += '<div class="form-group">';
    html += '<label class="form-label">Foto</label>';
    html += '<div class="image-upload" id="image-upload-area">';
    if (r.image) {
      html +=
        '<div class="image-upload__preview">' +
          '<button type="button" class="image-upload__change" data-action="trigger-image-upload" aria-label="Cambia foto">' +
            '<img src="' + esc(r.image) + '" alt="Anteprima" id="image-preview">' +
          '</button>' +
          '<button type="button" class="image-upload__remove" data-action="remove-image" aria-label="Rimuovi foto">' + Icons.x + '</button>' +
        '</div>';
    } else {
      html +=
        '<button type="button" class="image-upload__placeholder" id="image-placeholder" data-action="trigger-image-upload">' +
          Icons.camera +
          '<span>Tocca per aggiungere una foto</span>' +
        '</button>';
    }
    html += '</div>';
    html += '<input type="file" id="input-image" accept="image/jpeg,image/png,image/webp" class="hidden" aria-label="Seleziona foto">';
    html += '<input type="hidden" id="input-image-data" value="' + esc(r.image || '') + '">';
    html += '<input type="hidden" id="input-image-thumbnail-data" value="' + esc(r.imageThumbnail || '') + '">';
    html += '</div>';

    // Tab 1 Actions
    html +=
      '<div class="form-tab-actions">' +
        '<button type="button" class="btn btn--primary" data-action="next-tab" data-next="tab-prep">Avanti</button>' +
      '</div>';

    html += '</div>'; // close tab-info

    // ──────────────────── TAB 2: PREPARATION ────────────────────
    html += '<div id="tab-prep" class="form-tab" role="tabpanel" aria-labelledby="form-tab-prep" aria-hidden="true">';

    // Ingredienti
    html +=
      '<div class="form-group">' +
        '<label class="form-label">Ingredienti *</label>' +
        '<span class="form-error" id="error-ingredients"></span>' +
        '<div class="dynamic-list" id="ingredients-list">';
    html += ingredientRowsHTML(r.ingredients);
    html += '</div>';
    html += '<button type="button" class="dynamic-list__add btn btn--ghost btn--small" data-action="add-ingredient">' + Icons.plus + ' Aggiungi ingrediente</button>';
    html += '</div>';

    // Passaggi
    html +=
      '<div class="form-group">' +
        '<label class="form-label">Preparazione *</label>' +
        '<span class="form-error" id="error-steps"></span>' +
        '<div class="dynamic-list" id="steps-list">';
    html += stepRowsHTML(r.steps);
    html += '</div>';
    html += '<button type="button" class="dynamic-list__add btn btn--ghost btn--small" data-action="add-step">' + Icons.plus + ' Aggiungi passaggio</button>';
    html += '</div>';

    // Tab 2 Actions
    html +=
      '<div class="form-tab-actions">' +
        '<button type="button" class="btn btn--ghost" data-action="prev-tab" data-prev="tab-info">Indietro</button>' +
        '<button type="button" class="btn btn--primary" data-action="next-tab" data-next="tab-cook">Avanti</button>' +
      '</div>';

    html += '</div>'; // close tab-prep

    // ──────────────────── TAB 3: COOKING ────────────────────
    html += '<div id="tab-cook" class="form-tab" role="tabpanel" aria-labelledby="form-tab-cook" aria-hidden="true">';

    // Tempo preparazione
    html +=
      '<div class="form-group">' +
        '<label class="form-label" for="input-preptime">Tempo preparazione (minuti)</label>' +
        '<input type="number" class="form-input" id="input-preptime" min="0" max="' + Recipes.LIMITS.minutes + '" step="1" inputmode="numeric" placeholder="0" value="' + (r.prepTime || '') + '">' +
        '<span class="form-error" id="error-preptime"></span>' +
      '</div>';

    // Tempo cottura
    html +=
      '<div class="form-group">' +
        '<label class="form-label" for="input-cooktime">Tempo cottura (minuti)</label>' +
        '<input type="number" class="form-input" id="input-cooktime" min="0" max="' + Recipes.LIMITS.minutes + '" step="1" inputmode="numeric" placeholder="0" value="' + (r.cookTime || '') + '">' +
        '<span class="form-error" id="error-cooktime"></span>' +
      '</div>';

    // Difficoltà
    html +=
      '<div class="form-group">' +
        '<label class="form-label" for="input-difficulty">Difficoltà</label>' +
        '<select class="form-select" id="input-difficulty">';
    Recipes.DIFFICULTIES.forEach(function (d) {
      var sel = r.difficulty === d.id ? ' selected' : '';
      html += '<option value="' + esc(d.id) + '"' + sel + '>' + esc(d.emoji) + ' ' + esc(d.label) + '</option>';
    });
    html += '</select><span class="form-error" id="error-difficulty"></span></div>';

    // Porzioni
    html +=
      '<div class="form-group">' +
        '<label class="form-label" for="input-servings">Porzioni</label>' +
        '<input type="number" class="form-input" id="input-servings" min="1" max="' + Recipes.LIMITS.servings + '" step="1" inputmode="numeric" placeholder="4" value="' + (r.servings || '') + '">' +
        '<span class="form-error" id="error-servings"></span>' +
      '</div>';

    // Tab 3 Actions
    html +=
      '<div class="form-tab-actions form-tab-actions--submit">' +
        '<button type="button" class="btn btn--ghost" data-action="prev-tab" data-prev="tab-prep">Indietro</button>' +
        '<button type="button" class="btn btn--ghost" data-action="cancel-form">Annulla</button>' +
        '<button type="submit" class="btn btn--primary btn--grow">' + Icons.save + (isEdit ? ' Salva modifiche' : ' Salva ricetta') + '</button>' +
      '</div>';

    html += '</div>'; // close tab-cook

    html += '</form></div></div>';
    container.innerHTML = html;
  }

  function ingredientRowHTML(ing, index, total) {
    var esc = Utils.escapeHtml;
    var html =
      '<div class="dynamic-list__item ingredient-row" data-index="' + index + '">' +
        '<div class="ingredient-row-container">' +
          '<div class="ingredient-inputs">' +
            '<label class="dynamic-field ingredient-field ingredient-field--name">' +
              '<span class="dynamic-field__label">Ingrediente *</span>' +
              '<input type="text" class="form-input" maxlength="' + Recipes.LIMITS.ingredientName + '" placeholder="Es. Farina" data-field="ing-name" value="' + esc(ing.name || '') + '" aria-label="Nome ingrediente ' + (index + 1) + '" aria-describedby="error-ingredients" required>' +
            '</label>' +
            '<label class="dynamic-field ingredient-field ingredient-field--quantity">' +
              '<span class="dynamic-field__label">Quantità</span>' +
              '<input type="text" class="form-input" maxlength="' + Recipes.LIMITS.ingredientQuantity + '" placeholder="Es. 100" data-field="ing-qty" value="' + esc(ing.quantity || '') + '" aria-label="Quantità ingrediente ' + (index + 1) + '" aria-describedby="error-ingredients">' +
            '</label>' +
            '<label class="dynamic-field ingredient-field ingredient-field--unit">' +
              '<span class="dynamic-field__label">Unità</span>' +
              '<select class="form-select" data-field="ing-unit" aria-label="Unità ingrediente ' + (index + 1) + '" aria-describedby="error-ingredients">' +
              '<option value="">—</option>';
    Recipes.UNITS.forEach(function (u) {
      html += '<option value="' + esc(u) + '"' + (ing.unit === u ? ' selected' : '') + '>' + esc(u) + '</option>';
    });
    if (ing.unit && !Recipes.UNITS.includes(ing.unit)) {
      html += '<option value="' + esc(ing.unit) + '" selected>' + esc(ing.unit) + ' (dal backup)</option>';
    }
    html += '</select></label>';
    if (total > 1) {
      html += '<button type="button" class="btn btn--icon btn--small" data-action="remove-ingredient" data-index="' + index + '" aria-label="Rimuovi ingrediente ' + (index + 1) + '">' + Icons.x + '</button>';
    }
    html += '</div>';
    html += '<label class="dynamic-field ingredient-notes-container">' +
              '<span class="dynamic-field__label">Note ingrediente</span>' +
              '<input type="text" class="form-input" maxlength="' + Recipes.LIMITS.ingredientNotes + '" placeholder="Es. tiepido o setacciato" data-field="ing-notes" value="' + esc(ing.notes || '') + '" aria-label="Note ingrediente ' + (index + 1) + '">' +
            '</label>' +
        '</div>' +
      '</div>';
    return html;
  }

  function stepRowHTML(stepVal, index, total) {
    var esc = Utils.escapeHtml;
    var stepText = typeof stepVal === 'object' ? stepVal.text : stepVal;
    var stepNotes = typeof stepVal === 'object' ? stepVal.notes : '';
    var html =
      '<div class="dynamic-list__item step-item" data-index="' + index + '">' +
        '<span class="step-number">' + (index + 1) + '</span>' +
        '<div class="step-inputs">' +
          '<label class="dynamic-field">' +
            '<span class="dynamic-field__label">Descrizione passaggio *</span>' +
            '<textarea class="form-textarea" maxlength="' + Recipes.LIMITS.stepText + '" data-field="step-text" rows="2" placeholder="Descrivi cosa fare" aria-label="Descrizione passaggio ' + (index + 1) + '" aria-describedby="error-steps" required>' + esc(stepText || '') + '</textarea>' +
          '</label>' +
          '<label class="dynamic-field step-notes-container">' +
            '<span class="dynamic-field__label">Suggerimento opzionale</span>' +
            '<input type="text" class="form-input" maxlength="' + Recipes.LIMITS.stepNotes + '" placeholder="Es. mescola delicatamente" data-field="step-notes" value="' + esc(stepNotes || '') + '" aria-label="Suggerimento passaggio ' + (index + 1) + '">' +
          '</label>' +
        '</div>';
    if (total > 1) {
      html += '<button type="button" class="btn btn--icon btn--small" data-action="remove-step" data-index="' + index + '" aria-label="Rimuovi passaggio ' + (index + 1) + '">' + Icons.x + '</button>';
    }
    html += '</div>';
    return html;
  }

  function ingredientRowsHTML(ingredients) {
    return ingredients.map(function (ingredient, index) {
      return ingredientRowHTML(ingredient, index, ingredients.length);
    }).join('');
  }

  function stepRowsHTML(steps) {
    return steps.map(function (step, index) {
      return stepRowHTML(step, index, steps.length);
    }).join('');
  }

  /* ──────────────────── DETAIL VIEW ──────────────────── */

  async function renderDetail(container, recipeId) {
    var esc = Utils.escapeHtml;
    var recipe;

    try {
      recipe = await DB.getRecipe(recipeId);
    } catch (e) {
      recipe = null;
    }

    if (!recipe) {
      container.innerHTML = emptyStateHTML(Icons.frown, 'Ricetta non trovata', 'La ricetta richiesta non esiste più', 'Torna alla Home', 'go-home');
      return;
    }

    var cat = Utils.getCategoryInfo(recipe.category);
    var totalTime = Utils.getTotalTime(recipe.prepTime, recipe.cookTime);
    var diffEmoji = Utils.getDifficultyEmoji(recipe.difficulty);
    var favClass = recipe.isFavorite ? ' is-favorite' : '';

    var html = '<div class="view recipe-detail animate-fade-in">';

    // Hero
    if (recipe.image) {
      html +=
        '<div class="recipe-detail__hero">' +
          '<img src="' + esc(recipe.image) + '" alt="' + esc(recipe.name) + '">' +
          '<div class="recipe-detail__hero-overlay"></div>';
    } else {
      html +=
        '<div class="recipe-detail__hero-placeholder" style="background:linear-gradient(135deg,' + esc(cat.color) + ',' + esc(cat.color) + '88)">' +
          '<span style="font-size:4rem">' + esc(cat.icon) + '</span>';
    }
    // Overlay buttons
    html +=
      '<button type="button" class="recipe-detail__back" data-action="go-back" aria-label="Indietro">' + Icons.arrowLeft + '</button>' +
      '<button type="button" class="recipe-detail__actions recipe-card__favorite' + favClass + '" data-action="toggle-fav-detail" data-id="' + esc(recipe.id) + '" aria-label="' + (recipe.isFavorite ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti') + '" aria-pressed="' + recipe.isFavorite + '">' +
        (recipe.isFavorite ? Icons.heartFilled : Icons.heartOutline) +
      '</button>';
    html += '</div>';

    // Title
    html += '<h1 class="recipe-detail__title">' + esc(recipe.name) + '</h1>';

    // Category badge
    html += '<span class="recipe-card__category" style="' + categoryStyle(cat) + ';display:inline-block;margin:0 1rem .75rem">' +
              esc(cat.icon) + ' ' + esc(cat.label) +
            '</span>';

    // Info bar
    html +=
      '<div class="recipe-detail__info-bar">' +
        '<div class="recipe-detail__info-item"><span>' + Icons.clock + '</span><span>Prep: ' + esc(Utils.formatTime(recipe.prepTime || 0)) + '</span></div>' +
        '<div class="recipe-detail__info-item"><span>' + Icons.flame + '</span><span>Cottura: ' + esc(Utils.formatTime(recipe.cookTime || 0)) + '</span></div>' +
        '<div class="recipe-detail__info-item"><span>' + esc(diffEmoji) + '</span><span>' + esc(recipe.difficulty || 'facile') + '</span></div>' +
        '<div class="recipe-detail__info-item"><span>' + Icons.users + '</span>' +
          '<div style="display:inline-flex;align-items:center;gap:.3rem;">' +
            '<button type="button" class="btn btn--icon btn--small" data-action="scale-servings-down" aria-label="Riduci porzioni" style="width:40px;height:40px;min-width:40px;padding:0;font-size:18px;border:1px solid var(--border);border-radius:99px;line-height:1">-</button>' +
            '<span id="detail-servings-val" data-base-servings="' + (recipe.servings || 4) + '" style="font-weight:700;">' + (recipe.servings || 4) + '</span>' +
            '<span>porzioni</span>' +
            '<button type="button" class="btn btn--icon btn--small" data-action="scale-servings-up" aria-label="Aumenta porzioni" style="width:40px;height:40px;min-width:40px;padding:0;font-size:18px;border:1px solid var(--border);border-radius:99px;line-height:1">+</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    // Start Cooking Mode Button (hidden in print)
    html +=
      '<div class="no-print" style="padding:0 1rem;margin-bottom:1.25rem">' +
        '<button type="button" class="btn btn--primary" data-action="start-cooking" data-id="' + esc(recipe.id) + '" style="width:100%;display:flex;align-items:center;justify-content:center;gap:.6rem;font-size:1.05rem;padding:1rem 1.25rem;border-radius:var(--radius-lg);font-weight:800;letter-spacing:.02em;background:var(--gradient);box-shadow:0 6px 20px var(--shadow);transition:all .2s;position:relative;overflow:hidden">' +
          '<span style="font-size:1.3rem;line-height:1">🍳</span>' +
          ' Modalità cucina' +
          '<span style="font-size:.8rem;opacity:.75;margin-left:.25rem">(schermo attivo)</span>' +
        '</button>' +
      '</div>';

    // Description
    if (recipe.description) {
      html +=
        '<div class="recipe-detail__section recipe-detail__description-section">' +
          '<h3 class="recipe-detail__description-title">Descrizione</h3>' +
          '<p>' + esc(recipe.description) + '</p>' +
        '</div>';
    }

    // Notes (replicates "NOTE" block in PDF export)
    html +=
      '<div class="recipe-detail__section recipe-detail__notes-section' + (recipe.notes ? '' : ' print-only') + '">' +
        '<h3 class="recipe-detail__notes-title">Note</h3>' +
        (recipe.notes 
          ? '<p>' + esc(recipe.notes) + '</p>' 
          : '<div class="print-dotted-line"></div><div class="print-dotted-line"></div><div class="print-dotted-line"></div>') +
      '</div>';

    if (recipe.storage) {
      html +=
        '<div class="recipe-detail__section recipe-detail__notes-section recipe-detail__storage-section">' +
          '<h3 class="recipe-detail__notes-title">Conservazione</h3>' +
          '<p>' + esc(recipe.storage) + '</p>' +
        '</div>';
    }

    // Wrap ingredients and steps in a layout container for desktop side-by-side / cookbook print layout
    html += '<div class="recipe-detail__body-layout">';

    // Ingredienti
    html +=
      '<div class="recipe-detail__section recipe-detail__ingredients-section">' +
        '<h2 class="recipe-detail__section-title">Ingredienti</h2>' +
        '<ul class="ingredient-list">';
    if (recipe.ingredients && recipe.ingredients.length > 0) {
      recipe.ingredients.forEach(function (ing) {
        var qtyPart = ing.quantity ? '<span class="ingredient-item__qty ing-qty" data-base-qty="' + esc(ing.quantity) + '" data-unit="' + esc(ing.unit || '') + '">' + esc(ing.quantity) + (ing.unit ? ' ' + esc(ing.unit) : '') + '</span>' : '';
        var namePart = '<span class="ingredient-item__name ing-name">' + esc(ing.name) + '</span>';
        var notesHTML = ing.notes ? '<span class="ingredient-item__notes">💡 ' + esc(ing.notes) + '</span>' : '';

        html +=
          '<li class="ingredient-item">' +
            '<span class="ingredient-bullet">•</span>' +
            '<div class="ingredient-item__body">' +
              '<div class="ingredient-item__main">' +
                namePart + (qtyPart ? ' ' + qtyPart : '') +
              '</div>' +
              notesHTML +
            '</div>' +
          '</li>';
      });
    }
    html += '</ul></div>';

    // Preparazione
    html +=
      '<div class="recipe-detail__section recipe-detail__steps-section">' +
        '<h2 class="recipe-detail__section-title">Preparazione</h2>' +
        '<ol class="step-list">';
    if (recipe.steps && recipe.steps.length > 0) {
      recipe.steps.forEach(function (stepVal, idx) {
        var stepText = typeof stepVal === 'object' ? stepVal.text : stepVal;
        var stepNotes = typeof stepVal === 'object' ? stepVal.notes : '';
        var notesHTML = stepNotes ? '<span class="step-item__notes">Note: ' + esc(stepNotes) + '</span>' : '';
        html +=
          '<li class="step-item animate-slide-up stagger-' + ((idx % 8) + 1) + '">' +
            '<span class="step-number">' + (idx + 1) + '</span>' +
            '<div class="step-content">' +
              '<p>' + esc(stepText) + '</p>' +
              notesHTML +
            '</div>' +
          '</li>';
      });
    }
    html += '</ol></div>';

    html += '</div>'; // close recipe-detail__body-layout

    // Action buttons
    html +=
      '<div class="recipe-detail__section recipe-detail__actions-row" style="display:flex;gap:.75rem;flex-wrap:wrap">' +
        '<button type="button" class="btn btn--secondary" data-action="edit-recipe" data-id="' + esc(recipe.id) + '">' + Icons.edit + ' Modifica</button>' +
        '<button type="button" class="btn btn--secondary" data-action="export-pdf" data-id="' + esc(recipe.id) + '">' + Icons.download + ' Stampa / salva PDF</button>' +
        '<button type="button" class="btn btn--danger" data-action="delete-recipe" data-id="' + esc(recipe.id) + '">' + Icons.trash + ' Elimina</button>' +
      '</div>';

    // Dates
    html +=
      '<div class="recipe-detail__section recipe-detail__dates-row" style="font-size:.8rem;opacity:.6">' +
        '<p>Creata il ' + esc(Utils.formatDateTime(recipe.createdAt)) + '</p>' +
        (recipe.updatedAt && recipe.updatedAt !== recipe.createdAt
          ? '<p>Modificata il ' + esc(Utils.formatDateTime(recipe.updatedAt)) + '</p>'
          : '') +
      '</div>';

    html += '</div>';
    container.innerHTML = html;
  }

  /* ──────────────────── FAVORITES VIEW ──────────────────── */

  async function renderFavorites(container) {
    var recipes = await DB.getRecipeSummaries();
    var favs = recipes.filter(function (r) { return r.isFavorite; });

    var html = '<div class="view animate-fade-in">';
    html += '<div class="view-header"><h1 class="view-header__title">Le mie ricette preferite</h1></div>';

    if (favs.length > 0) {
      html += recipeGridHTML(favs);
    } else {
      html += emptyStateHTML(Icons.heartCrack, 'Nessun preferito!', 'Tocca il cuore su una ricetta per aggiungerla qui', null, null);
    }

    html += '</div>';
    container.innerHTML = html;
  }

  /* ──────────────────── SETTINGS VIEW ──────────────────── */

  async function renderSettings(container) {
    var esc = Utils.escapeHtml;
    var theme = Theme.getCurrentTheme();
    var isDark = theme.mode === 'dark';
    var currentPalette = theme.palette || 'classico';
    var settingsData = await Promise.all([
      DB.countRecipes(),
      DB.getSetting('lastBackupAt'),
      SyncPreparation.getStatus(),
      StorageHealth.read()
    ]);
    var count = settingsData[0];
    var lastBackupAt = Number(settingsData[1]);
    var syncStatus = settingsData[2];
    var storageHealth = settingsData[3];
    var backupStale = count > 0 && (
      !Number.isFinite(lastBackupAt) ||
      lastBackupAt <= 0 ||
      Date.now() - lastBackupAt > 30 * 24 * 60 * 60 * 1000
    );
    var lastBackupText = Number.isFinite(lastBackupAt) && lastBackupAt > 0
      ? new Date(lastBackupAt).toLocaleString('it-IT', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        })
      : 'Mai eseguito';
    var storageUsageText = storageHealth.usageBytes !== null &&
      storageHealth.quotaBytes !== null
      ? StorageHealth.formatBytes(storageHealth.usageBytes) + ' usati su ' +
        StorageHealth.formatBytes(storageHealth.quotaBytes) + ' (' +
        storageHealth.usagePercent + '%)'
      : 'Il browser non rende disponibile una stima affidabile.';
    var persistenceText = storageHealth.persisted === true
      ? 'Archivio protetto dalla pulizia automatica del browser.'
      : storageHealth.persistenceRequestSupported
        ? 'La protezione avanzata non è ancora attiva su questo dispositivo.'
        : 'Questo browser gestisce automaticamente la conservazione dei dati.';
    var protectionUrgent = backupStale || storageHealth.level === 'critical';

    var palettes = Theme.PALETTES;

    var html = '<div class="view settings-view animate-fade-in">';
    html += '<div class="view-header"><h1 class="view-header__title">Impostazioni</h1></div>';
    html += '<div class="settings-grid">';

    // — CARD: Aspetto —
    html += '<div class="settings-card settings-card--appearance">';
    html += '<div class="settings-card__header"><span class="settings-card__icon">' + Icons.palette + '</span><h2 class="settings-card__title">Aspetto</h2></div>';
    html += '<div class="settings-card__body">';
    // Dark mode toggle
    html +=
      '<div class="settings-item">' +
        '<div class="settings-item__info">' +
          '<div class="settings-item__label">Tema scuro</div>' +
          '<div class="settings-item__description">Riduce la luminosità e affatica meno gli occhi</div>' +
        '</div>' +
        '<div class="settings-item__control">' +
          '<label class="toggle-switch">' +
            '<input type="checkbox" data-action="toggle-dark" aria-label="Tema scuro"' + (isDark ? ' checked' : '') + '>' +
            '<span class="toggle-slider"></span>' +
          '</label>' +
        '</div>' +
      '</div>';
    // Palette
    html +=
      '<div class="settings-item settings-item--column">' +
        '<div class="settings-item__label">Palette colori</div>' +
        '<div class="theme-selector" role="radiogroup" aria-label="Palette colori">';
    palettes.forEach(function (p) {
      var isSelected = currentPalette === p.id;
      html +=
        '<button type="button" role="radio" aria-checked="' + isSelected + '" tabindex="' + (isSelected ? '0' : '-1') + '" class="theme-option' + (isSelected ? ' active' : '') + '" data-action="set-palette" data-palette="' + esc(p.id) + '" aria-label="' + esc(p.label) + '">' +
          '<span class="theme-circle" style="background:' + p.gradient + '"></span>' +
          '<span class="theme-name">' + esc(p.label) + '</span>' +
        '</button>';
    });
    html += '</div></div>';
    html += '</div></div>'; // close body + card

    // — CARD: Account e sincronizzazione —
    html += AccountView.renderSettingsCard(syncStatus);

    // — CARD: Categorie —
    html += '<div class="settings-card settings-card--categories">';
    html += '<div class="settings-card__header"><span class="settings-card__icon">' + Icons.bookOpen + '</span><h2 class="settings-card__title">Categorie</h2></div>';
    html += '<div class="settings-card__body">';
    
    // Categorie personalizzate esistenti
    html += '<div class="settings-item settings-item--column">';
    html += '<div class="settings-item__label">Le tue categorie</div>';
    html += '<div class="custom-categories-list">';
    
    var customCats = Recipes.CATEGORIES.filter(function (cat) {
      return cat.isCustom;
    });
    
    if (customCats.length === 0) {
      html += '<p class="settings-empty-copy">Non hai ancora creato categorie personalizzate.</p>';
    } else {
      customCats.forEach(function (cat) {
        html += '<div class="custom-cat-chip" style="' + categoryStyle(cat) + '; border-color:' + esc(cat.color) + '">' +
                  '<span>' + esc(cat.icon) + ' ' + esc(cat.label) + '</span>' +
                  '<button type="button" class="btn-delete-cat" data-action="delete-category" data-id="' + esc(cat.id) + '" aria-label="Elimina categoria ' + esc(cat.label) + '">' + Icons.x + '</button>' +
                '</div>';
      });
    }
    html += '</div></div>';

    // Form aggiungi categoria
    html += '<div class="settings-item settings-item--column">';
    html += '<div class="settings-item__label">Aggiungi nuova categoria</div>';
    if (customCats.length >= DB.MAX_CUSTOM_CATEGORIES) {
      html += '<p class="settings-empty-copy">Hai raggiunto il limite di ' + DB.MAX_CUSTOM_CATEGORIES + ' categorie personalizzate.</p>';
    } else {
      html += '<div class="add-category-form">';
      html += '<input type="text" id="input-cat-label" class="form-input add-category-form__name" maxlength="60" placeholder="Es. Ricette veloci" aria-label="Nome nuova categoria">';
      html += '<input type="text" id="input-cat-icon" class="form-input add-category-form__icon" maxlength="16" placeholder="Emoji" aria-label="Emoji nuova categoria">';
      html += '<select id="input-cat-color" class="form-select add-category-form__color" aria-label="Colore nuova categoria">' +
                '<option value="#E85D3A">Arancione</option>' +
                '<option value="#0EA5E9">Azzurro</option>' +
                '<option value="#16A34A">Verde</option>' +
                '<option value="#A855F7">Viola</option>' +
                '<option value="#EC4899">Rosa</option>' +
                '<option value="#FBBF24">Giallo</option>' +
              '</select>';
      html += '<button type="button" class="btn btn--secondary add-category-form__submit" data-action="add-category">' + Icons.plus + ' Aggiungi</button>';
      html += '</div>';
    }
    html += '</div>';
    
    html += '</div></div>'; // close body + card

    // — CARD: Dati e backup —
    html += '<div class="settings-card settings-card--data">';
    html += '<div class="settings-card__header"><span class="settings-card__icon">' + Icons.database + '</span><h2 class="settings-card__title">Dati e backup</h2></div>';
    html += '<div class="settings-card__body">';
    html += '<div class="settings-warning-banner' +
              (protectionUrgent ? ' settings-warning-banner--urgent' : '') + '">' +
              '<span class="settings-warning-banner__icon">⚠️</span>' +
              '<div>' +
                '<strong>Proteggi il tuo ricettario</strong>' +
                '<p>' +
                  (backupStale
                    ? 'Il backup manca o ha più di 30 giorni. Creane uno adesso per non rischiare di perdere le ricette.'
                    : 'Le ricette restano su questo dispositivo. Mantieni aggiornato il <strong>Backup JSON</strong>.') +
                '</p>' +
              '</div>' +
            '</div>';
    html +=
      '<div class="settings-item">' +
        '<div class="settings-item__info">' +
          '<div class="settings-item__label">Ricette salvate</div>' +
          '<div class="settings-item__description"><strong>' + count + '</strong> ricett' + (count === 1 ? 'a' : 'e') + ' nel tuo ricettario</div>' +
        '</div>' +
      '</div>';
    html +=
      '<div class="settings-item">' +
        '<div class="settings-item__info">' +
          '<div class="settings-item__label">Ultimo backup JSON</div>' +
          '<div class="settings-item__description' + (backupStale ? ' backup-status--stale' : '') +
            '" id="last-backup-status" aria-live="polite">' + esc(lastBackupText) + '</div>' +
        '</div>' +
      '</div>';
    html +=
      '<div class="settings-item settings-item--column">' +
        '<div class="settings-item__label">Spazio e protezione locale</div>' +
        '<div class="storage-health storage-health--' + esc(storageHealth.level) + '">' +
          '<div class="settings-item__description" id="storage-health-status" aria-live="polite">' +
            esc(storageUsageText) + ' ' + esc(persistenceText) +
          '</div>' +
          (storageHealth.usagePercent !== null
            ? '<div class="storage-health__meter" role="meter" aria-label="Spazio locale utilizzato" ' +
                'aria-valuemin="0" aria-valuemax="100" aria-valuenow="' +
                esc(String(storageHealth.usagePercent)) + '">' +
                '<span style="--storage-usage:' +
                  esc(String(Math.min(100, storageHealth.usagePercent))) + '%"></span>' +
              '</div>'
            : '') +
          (storageHealth.persisted !== true && storageHealth.persistenceRequestSupported
            ? '<div class="storage-health__actions">' +
                '<button type="button" class="btn btn--secondary" data-action="request-storage-persistence">' +
                  Icons.database + ' Proteggi archivio' +
                '</button>' +
                '<span class="settings-item__description">La richiesta parte solo quando premi il pulsante.</span>' +
              '</div>'
            : '') +
        '</div>' +
      '</div>';
    html +=
      '<div class="settings-actions">' +
        '<button type="button" class="btn btn--secondary" data-action="export-pdf-all">' + Icons.download + ' Ricettario PDF</button>' +
        '<button type="button" class="btn btn--secondary" data-action="export-data">' + Icons.download + ' Backup JSON</button>' +
        '<button type="button" class="btn btn--secondary" data-action="import-data">' + Icons.upload + ' Importa</button>' +
        '<input type="file" id="import-file-input" accept=".json,application/json" class="hidden">' +
      '</div>';
    html += '</div></div>';

    // — CARD: Informazioni —
    html += '<div class="settings-card settings-card--info">';
    html += '<div class="settings-card__header"><span class="settings-card__icon">' + Icons.infoCircle + '</span><h2 class="settings-card__title">Informazioni</h2></div>';
    html += '<div class="settings-card__body">';
    html +=
      '<div class="settings-item">' +
        '<div class="settings-item__info">' +
          '<div class="settings-item__label">Versione</div>' +
          '<div class="settings-item__description">1.0.0</div>' +
        '</div>' +
      '</div>';
    html +=
      '<div class="settings-item">' +
        '<div class="settings-item__info">' +
          '<div class="settings-item__label">Sapori</div>' +
          '<div class="settings-item__description">Il tuo ricettario personale</div>' +
        '</div>' +
      '</div>';
    html +=
      '<div class="settings-item">' +
        '<div class="settings-item__info">' +
          '<div class="settings-item__label">' + Icons.shield + ' Privacy</div>' +
          '<div class="settings-item__description">I tuoi dati sono salvati localmente sul dispositivo</div>' +
        '</div>' +
      '</div>';
    html += '</div></div>';
    html += '</div>'; // close settings-grid

    // Footer
    html += '<div class="settings-footer"><p>Creato con cura in Italia 🇮🇹</p></div>';
    html += '</div>';

    container.innerHTML = html;
  }

  /* ──────────────────── MODAL ──────────────────── */

  /* ──────────────────── PANTRY / SVUOTAFRIGO VIEW ──────────────────── */

  async function renderPantry(container, userIngredients) {
    userIngredients = userIngredients || [];
    var esc = Utils.escapeHtml;
    var recipes = await DB.getRecipeSummaries();
    var matches = Recipes.matchPantry(recipes, userIngredients);

    var html = '<div class="view pantry-view animate-fade-in">';
    
    // Header
    html += '<div class="view-header view-header--back pantry-header">';
    html += '<button type="button" class="btn btn--icon view-back-button" data-action="go-home" aria-label="Torna indietro">' + Icons.arrowLeft + '</button>';
    html += '<div class="pantry-header__copy"><h1 class="view-header__title">👨‍🍳 Svuotafrigo</h1>';
    html += '<p class="view-header__subtitle">Scrivi ciò che hai in casa: ti mostriamo cosa puoi cucinare.</p></div></div>';

    // Input form for ingredients
    html += '<div class="pantry-card">';
    html += '<form id="pantry-form" class="pantry-input-row">';
    html += '<label class="sr-only" for="pantry-input">Ingredienti disponibili</label>';
    html += '<input type="text" id="pantry-input" class="form-input" placeholder="Es. uova" autocomplete="off">';
    html += '<button type="submit" class="btn btn--primary" data-action="add-pantry-ingredient">' + Icons.plus + ' Aggiungi</button>';
    html += '</form>';

    // Quick suggestions
    var quicks = ['Uova', 'Farina', 'Latte', 'Pomodoro', 'Burro', 'Pasta', 'Riso', 'Carne', 'Zucchine', 'Patate', 'Formaggio', 'Olio'];
    html += '<div class="pantry-suggestions"><span class="pantry-section-label">Suggerimenti rapidi</span>';
    html += '<div class="pantry-suggestions__list">';
    quicks.forEach(function(q) {
      var isAdded = userIngredients.some(function(u){ return u.toLowerCase() === q.toLowerCase(); });
      if (!isAdded) {
        html += '<button type="button" class="pantry-quick-btn" data-action="add-quick-pantry" data-ingredient="' + esc(q) + '">+ ' + esc(q) + '</button>';
      }
    });
    html += '</div></div>';

    // Selected ingredient chips
    if (userIngredients.length > 0) {
      html += '<div class="pantry-selected__header">';
      html += '<span>Ingredienti selezionati (' + userIngredients.length + ')</span>';
      html += '<button type="button" class="btn btn--ghost btn--small pantry-clear-btn" data-action="clear-pantry">Pulisci</button>';
      html += '</div>';
      html += '<div class="pantry-selected__list">';
      userIngredients.forEach(function(ing, idx) {
        html += '<span class="pantry-chip">';
        html += esc(ing);
        html += '<button type="button" data-action="remove-pantry-ingredient" data-index="' + idx + '" aria-label="Rimuovi ' + esc(ing) + '">' + Icons.x + '</button>';
        html += '</span>';
      });
      html += '</div>';
    } else {
      html += '<p class="pantry-empty-copy">Aggiungi almeno un ingrediente per iniziare la ricerca.</p>';
    }

    html += '</div>'; // close pantry-card

    // Results section
    if (userIngredients.length === 0) {
      html += emptyStateHTML(Icons.searchLg, 'Trova la ricetta giusta', 'Aggiungi ciò che hai in casa e confrontalo con il tuo ricettario.', null, null);
    } else if (matches.length === 0) {
      html += emptyStateHTML(Icons.frown, 'Nessuna ricetta trovata', 'Nessuna ricetta nel tuo ricettario contiene gli ingredienti selezionati', null, null);
    } else {
      var complete = matches.filter(function(m){ return m.isComplete; });
      var partial = matches.filter(function(m){ return !m.isComplete; });

      html += '<div class="pantry-results">';

      if (complete.length > 0) {
        html += '<h2 style="font-size:1.1rem;font-weight:700;color:var(--success);margin-bottom:.75rem;display:flex;align-items:center;gap:.4rem">🟢 Pronti da cucinare (Hai tutti gli ingredienti - ' + complete.length + ')</h2>';
        html += '<div class="recipe-grid" style="margin-bottom:1.5rem">';
        complete.forEach(function(m) {
          html += pantryCardHTML(m);
        });
        html += '</div>';
      }

      if (partial.length > 0) {
        html += '<h2 style="font-size:1.1rem;font-weight:700;color:var(--warning);margin-bottom:.75rem;display:flex;align-items:center;gap:.4rem">🟡 Ti manca pochissimo (' + partial.length + ')</h2>';
        html += '<div class="recipe-grid">';
        partial.forEach(function(m) {
          html += pantryCardHTML(m);
        });
        html += '</div>';
      }

      html += '</div>';
    }

    html += '</div>';
    container.innerHTML = html;
  }

  function pantryCardHTML(matchItem) {
    var esc = Utils.escapeHtml;
    var r = matchItem.recipe;
    var cat = Utils.getCategoryInfo(r.category);
    var badgeColor = matchItem.isComplete ? 'var(--success)' : 'var(--warning)';
    var badgeTextColor = matchItem.isComplete ? 'var(--on-success)' : 'var(--on-warning)';
    var badgeText = matchItem.isComplete 
      ? '🟢 100% Ingredienti' 
      : '🟡 ' + matchItem.matchedCount + ' su ' + matchItem.totalCount + ' ingredienti';

    var html = '<div class="recipe-card animate-fade-in" data-id="' + esc(r.id) + '">';
    html += '<div class="recipe-card__content">';
    html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:.5rem;margin-bottom:.4rem">';
    html += '<span class="recipe-card__category" style="' + categoryStyle(cat) + '">' + esc(cat.icon) + ' ' + esc(cat.label) + '</span>';
    html += '<span style="background:' + badgeColor + ';color:' + badgeTextColor + ';font-size:.72rem;font-weight:700;padding:2px 8px;border-radius:99px">' + esc(badgeText) + '</span>';
    html += '</div>';

    html += '<h3 class="recipe-card__title" style="margin-bottom:.4rem">' + esc(r.name) + '</h3>';

    if (matchItem.missingNames.length > 0) {
      html += '<div style="font-size:.75rem;color:var(--danger);margin-bottom:.6rem"><strong>Mancano:</strong> ' + esc(matchItem.missingNames.join(', ')) + '</div>';
    } else {
      html += '<div style="font-size:.75rem;color:var(--success);margin-bottom:.6rem"><strong>Includi:</strong> ' + esc(matchItem.matchedNames.join(', ')) + '</div>';
    }

    html += '<button type="button" class="btn btn--primary btn--small" data-action="open-recipe" data-id="' + esc(r.id) + '" style="width:100%">Vedi Ricetta</button>';
    html += '</div></div>';
    return html;
  }

  function showCookingModal(recipe, stepIndex, checkedIngredients, wakeLockActive, timerState, ingExpanded) {
    stepIndex = stepIndex || 0;
    checkedIngredients = checkedIngredients || {};
    if (typeof ingExpanded === 'undefined') ingExpanded = true;
    var esc = Utils.escapeHtml;
    var overlay = document.getElementById('modal-overlay');
    var totalSteps = (recipe.steps && recipe.steps.length) || 0;
    var isFinished = stepIndex >= totalSteps;

    var stepVal = (recipe.steps && recipe.steps[stepIndex]) || '';
    var stepText = typeof stepVal === 'object' ? stepVal.text : stepVal;
    var stepNotes = typeof stepVal === 'object' ? stepVal.notes : '';

    // Progress
    var pct = totalSteps > 0
      ? Math.min(100, Math.round(((stepIndex + 1) / totalSteps) * 100))
      : 0;
    var checkedCount = Object.values(checkedIngredients).filter(Boolean).length;
    var totalIng = (recipe.ingredients && recipe.ingredients.length) || 0;

    // Timer state
    timerState = timerState || { minutes: 0, seconds: 0, running: false, totalSeconds: 0 };
    var timerDisplay = (isNaN(timerState.minutes) ? '00' : String(timerState.minutes).padStart(2,'0')) +
                       ':' +
                       (isNaN(timerState.seconds) ? '00' : String(timerState.seconds).padStart(2,'0'));
    var timerClass = timerState.running
      ? (timerState.minutes === 0 && timerState.seconds <= 10 ? 'cooking-modal__timer-display--danger' :
         timerState.minutes === 0 && timerState.seconds <= 30 ? 'cooking-modal__timer-display--warning' :
         'cooking-modal__timer-display--running')
      : '';
    var timerInputDisabled = timerState.running ? ' disabled' : '';

    var html = '<div class="cooking-modal" id="cooking-modal-inner" role="dialog" aria-modal="true" aria-labelledby="cooking-modal-title">';

    // Accent bar
    html += '<div class="cooking-modal__accent-bar"></div>';

    // ── Header ──
    var wlClass = wakeLockActive ? 'cooking-modal__wakelock--active' : 'cooking-modal__wakelock--inactive';
    var wlText  = wakeLockActive ? '⚡ Schermo attivo' : '📱 Standard';
    html += '<div class="cooking-modal__header">';
    html +=   '<div class="cooking-modal__header-left">';
    html +=     '<span class="cooking-modal__label">👨‍🍳 Modalità cucina</span>';
    html +=     '<h2 class="cooking-modal__title" id="cooking-modal-title">' + esc(recipe.name) + '</h2>';
    html +=   '</div>';
    html +=   '<div class="cooking-modal__header-right">';
    html +=     '<span class="cooking-modal__wakelock ' + wlClass + '">' + wlText + '</span>';
    html +=     '<button type="button" class="cooking-modal__close" data-action="close-cooking" aria-label="Chiudi modalità cucina">' + Icons.x + '</button>';
    html +=   '</div>';
    html += '</div>';

    if (!isFinished) {
      // ── Progress bar ──
      html += '<div class="cooking-modal__progress-wrap">';
      html +=   '<div class="cooking-modal__progress-info">';
      html +=     '<span class="cooking-modal__step-counter">Passaggio ' + (stepIndex + 1) + ' di ' + totalSteps + '</span>';
      html +=     '<span class="cooking-modal__progress-pct">' + pct + '%</span>';
      html +=   '</div>';
      html +=   '<div class="cooking-modal__progress-bar-bg" role="progressbar" aria-label="Avanzamento preparazione" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '" aria-valuetext="Passaggio ' + (stepIndex + 1) + ' di ' + totalSteps + '">';
      html +=     '<div class="cooking-modal__progress-bar-fill" style="width:' + pct + '%"></div>';
      html +=   '</div>';
      html += '</div>';

      // ── Step dots ──
      if (totalSteps <= 20) {
        html += '<div class="cooking-modal__dots">';
        for (var d = 0; d < totalSteps; d++) {
          var dotClass = d < stepIndex ? 'cooking-modal__dot cooking-modal__dot--done' :
                         d === stepIndex ? 'cooking-modal__dot cooking-modal__dot--active' :
                         'cooking-modal__dot';
          var dotContent = d < stepIndex ? '✓' : (d + 1);
          html += '<button type="button" class="' + dotClass + '" data-action="cooking-goto" data-step="' + d + '" aria-label="Vai al passaggio ' + (d+1) + '">' + dotContent + '</button>';
        }
        html += '</div>';
      }

      // ── Scrollable body ──
      html += '<div class="cooking-modal__body">';

      // Step card
      html += '<div class="cooking-modal__step-card">';
      html +=   '<span class="cooking-modal__step-badge">🔥 Passaggio ' + (stepIndex + 1) + ' / ' + totalSteps + '</span>';
      html +=   '<p class="cooking-modal__step-text">' + esc(stepText) + '</p>';
      if (stepNotes) {
        html += '<div class="cooking-modal__step-notes"><strong>💡 Nota:</strong>&nbsp;' + esc(stepNotes) + '</div>';
      }
      html += '</div>';

      // Ingredients panel
      if (totalIng > 0) {
        var ingListClass = 'cooking-modal__ing-list' + (ingExpanded ? '' : ' cooking-modal__ing-list--collapsed');
        var toggleClass  = 'cooking-modal__ing-toggle' + (ingExpanded ? ' cooking-modal__ing-toggle--open' : '');
        var ingPct = totalIng > 0 ? checkedCount + '/' + totalIng : '';

        html += '<div class="cooking-modal__ing-panel">';
        html +=   '<button type="button" class="cooking-modal__ing-header" data-action="toggle-cooking-ing-panel" aria-expanded="' + ingExpanded + '" aria-controls="cooking-ing-list">';
        html +=     '<span class="cooking-modal__ing-title">🛒 Ingredienti';
        if (ingPct) html += '&nbsp;<span class="cooking-modal__ing-progress">' + ingPct + ' ✓</span>';
        html +=     '</span>';
        html +=     '<span class="' + toggleClass + '">▼</span>';
        html +=   '</button>';
        html +=   '<div class="' + ingListClass + '" id="cooking-ing-list">';
        recipe.ingredients.forEach(function(ing, idx) {
          var isChecked = !!checkedIngredients[idx];
          var chipClass = 'cooking-modal__ing-chip' + (isChecked ? ' cooking-modal__ing-chip--checked' : '');
          var parts = [];
          if (ing.quantity) parts.push(esc(ing.quantity));
          if (ing.unit) parts.push(esc(ing.unit));
          parts.push(esc(ing.name));
          html += '<button type="button" class="' + chipClass + '" data-action="toggle-cooking-ing" data-index="' + idx + '" aria-pressed="' + isChecked + '">';
          html +=   '<span class="ing-chip-check">' + (isChecked ? '✓' : '○') + '</span>';
          html +=   parts.join(' ');
          html += '</button>';
        });
        html += '</div>';
        html += '</div>';
      }

      // Timer
      html += '<div class="cooking-modal__timer">';
      html +=   '<div>';
      html +=     '<div class="cooking-modal__timer-label">⏱ Timer</div>';
      html +=     '<div class="cooking-modal__timer-display ' + timerClass + '" id="cooking-timer-display">' + timerDisplay + '</div>';
      html +=   '</div>';
      html +=   '<div style="display:flex;flex-direction:column;align-items:center;gap:6px">';
      html +=     '<div class="cooking-modal__timer-input-wrap">';
      html +=       '<input type="number" class="cooking-modal__timer-input" id="cooking-timer-min" min="0" max="' + Recipes.LIMITS.minutes + '" value="' + (timerState.minutes || 0) + '" aria-label="Minuti"' + timerInputDisabled + '>';
      html +=       '<span style="font-weight:700;color:var(--text-muted)">:</span>';
      html +=       '<input type="number" class="cooking-modal__timer-input" id="cooking-timer-sec" min="0" max="59" value="' + (timerState.seconds || 0) + '" aria-label="Secondi"' + timerInputDisabled + '>';
      html +=     '</div>';
      html +=     '<div class="cooking-modal__timer-controls">';
      if (timerState.running) {
        html +=   '<button type="button" class="cooking-modal__timer-btn" data-action="cooking-timer-pause" aria-label="Pausa timer">⏸</button>';
      } else {
        html +=   '<button type="button" class="cooking-modal__timer-btn cooking-modal__timer-btn--start" data-action="cooking-timer-start" aria-label="Avvia timer">▶</button>';
      }
      html +=     '<button type="button" class="cooking-modal__timer-btn" data-action="cooking-timer-reset" aria-label="Azzera timer">↺</button>';
      html +=     '</div>';
      html +=   '</div>';
      html += '</div>';

      // Swipe hint (only mobile)
      html += '<div class="cooking-modal__swipe-hint">← scorri per cambiare passaggio →</div>';

      html += '</div>'; // .cooking-modal__body

      // ── Footer nav ──
      html += '<div class="cooking-modal__footer">';
      var prevDisabled = stepIndex === 0 ? ' disabled' : '';
      var nextLabel = stepIndex >= totalSteps - 1 ? '🏁 Fine!' : 'Avanti →';
      var nextClass = 'cooking-modal__nav-btn cooking-modal__nav-btn--primary';
      html += '<button type="button" class="cooking-modal__nav-btn" data-action="cooking-prev" data-step="' + (stepIndex - 1) + '"' + prevDisabled + '>← Indietro</button>';
      html += '<button type="button" class="' + nextClass + '" data-action="cooking-next" data-step="' + (stepIndex + 1) + '">' + nextLabel + '</button>';
      html += '</div>';

    } else {
      // ── Finish screen ──
      html += '<div class="cooking-modal__finish">';
      html +=   '<div class="cooking-modal__finish-emoji">🎉</div>';
      html +=   '<h2 class="cooking-modal__finish-title">Buon appetito!</h2>';
      html +=   '<p class="cooking-modal__finish-subtitle">' + esc(recipe.name) + ' è pronto!</p>';
      html +=   '<button type="button" class="cooking-modal__nav-btn cooking-modal__nav-btn--primary" data-action="close-cooking" style="max-width:260px;margin-top:8px">✓ Chiudi</button>';
      html +=   '<button type="button" class="cooking-modal__nav-btn" data-action="cooking-prev" data-step="' + (totalSteps - 1) + '" style="max-width:260px">← Torna all\'ultimo passaggio</button>';
      html += '</div>';
    }

    html += '</div>'; // .cooking-modal

    overlay.innerHTML = html;
    overlay.classList.remove('hidden');

    // ── Touch swipe gesture (mobile) ──
    var modal = document.getElementById('cooking-modal-inner');
    if (modal) {
      var touchStartX = 0;
      var touchStartY = 0;
      modal.addEventListener('touchstart', function(e) {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
      }, { passive: true });
      modal.addEventListener('touchend', function(e) {
        var dx = e.changedTouches[0].clientX - touchStartX;
        var dy = e.changedTouches[0].clientY - touchStartY;
        // Only fire if horizontal swipe is dominant and significant
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
          var swipeBtn = document.querySelector(dx < 0 ? '[data-action="cooking-next"]' : '[data-action="cooking-prev"]');
          if (swipeBtn && !swipeBtn.disabled) swipeBtn.click();
        }
      }, { passive: true });
    }
  }

  function showConfirmModal(title, message, onConfirm, options) {
    var esc = Utils.escapeHtml;
    var overlay = document.getElementById('modal-overlay');
    options = options || {};
    var cancelLabel = options.cancelLabel || 'Annulla';
    var confirmLabel = options.confirmLabel || 'Conferma';
    var confirmClass = options.confirmClass === 'btn--primary' ? 'btn--primary' : 'btn--danger';

    overlay.innerHTML =
      '<div class="modal animate-slide-up" role="dialog" aria-modal="true" aria-labelledby="confirm-modal-title">' +
        '<div class="modal__header"><h3 id="confirm-modal-title">' + esc(title) + '</h3></div>' +
        '<div class="modal__body"><p>' + esc(message) + '</p></div>' +
        '<div class="modal__footer">' +
          '<button type="button" class="btn btn--ghost" data-action="modal-cancel">' + esc(cancelLabel) + '</button>' +
          '<button type="button" class="btn ' + confirmClass + '" data-action="modal-confirm">' + esc(confirmLabel) + '</button>' +
        '</div>' +
      '</div>';

    overlay.classList.remove('hidden');

    // Store callback for app.js to use
    overlay._onConfirm = onConfirm;
  }

  function showImportPreviewModal(preview, onMerge, onReplace) {
    var overlay = document.getElementById('modal-overlay');
    var summary = [
      '<strong>' + preview.additions + '</strong> nuove',
      '<strong>' + preview.updates + '</strong> aggiornabili',
      '<strong>' + preview.duplicates + '</strong> duplicate',
      '<strong>' + preview.conflicts + '</strong> conflitti protetti',
      '<strong>' + preview.rejected + '</strong> non valide'
    ].join(' · ');

    overlay.innerHTML =
      '<div class="modal modal--import-preview animate-slide-up" role="dialog" aria-modal="true" aria-labelledby="import-preview-title">' +
        '<div class="modal__header"><h3 id="import-preview-title">Anteprima importazione</h3></div>' +
        '<div class="modal__body">' +
          '<p>Il file contiene <strong>' + preview.total + '</strong> ricett' + (preview.total === 1 ? 'a valida' : 'e valide') + '.</p>' +
          '<p style="margin-top:.75rem;color:var(--text-secondary)">' + summary + '</p>' +
          (preview.categories ? '<p style="margin-top:.5rem">' + preview.categories + ' categorie personalizzate incluse.</p>' : '') +
          '<p style="margin-top:.75rem;font-size:.85rem;color:var(--text-muted)">Unisci aggiorna soltanto le versioni più recenti, ignora i duplicati e conserva le modifiche locali in conflitto. Sostituisci elimina prima le ricette attuali.</p>' +
        '</div>' +
        '<div class="modal__footer modal__footer--import">' +
          '<button type="button" class="btn btn--ghost" data-action="modal-cancel">Annulla</button>' +
          (onReplace ? '<button type="button" class="btn btn--danger" id="btn-import-replace">Sostituisci</button>' : '') +
          '<button type="button" class="btn btn--primary" id="btn-import-merge">Unisci</button>' +
        '</div>' +
      '</div>';

    overlay.classList.remove('hidden');
    document.getElementById('btn-import-merge').addEventListener('click', onMerge);
    var replaceButton = document.getElementById('btn-import-replace');
    if (replaceButton) replaceButton.addEventListener('click', onReplace);
  }

  /**
   * Build the canonical printable layout used by individual recipes and the
   * complete cookbook. Keeping one template prevents print layout drift.
   * @param {Object} recipe
   * @param {Object} [options]
   * @returns {string}
   */
  function buildPrintableRecipeHTML(recipe, options) {
    options = options || {};
    var esc = Utils.escapeHtml;
    var cat = Utils.getCategoryInfo(recipe.category);
    var diffEmoji = Utils.getDifficultyEmoji(recipe.difficulty);
    var diffMap = { facile: 'Facile', media: 'Media', difficile: 'Difficile' };
    var totalMinutes = (parseInt(recipe.prepTime, 10) || 0) + (parseInt(recipe.cookTime, 10) || 0);
    var printedOn = options.printedOn || new Date().toLocaleDateString('it-IT', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
    var appUrl = options.appUrl || (window.location.origin + window.location.pathname);
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
          '<div><dt>Preparazione</dt><dd>' + esc(Utils.formatTime(recipe.prepTime || 0)) + '</dd></div>' +
          '<div><dt>Cottura</dt><dd>' + esc(Utils.formatTime(recipe.cookTime || 0)) + '</dd></div>' +
          '<div><dt>Tempo totale</dt><dd>' + esc(Utils.formatTime(totalMinutes)) + '</dd></div>' +
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
        '<footer class="print-recipe-sheet__footer">' +
          '<span>Stampato il ' + esc(printedOn) + '</span>' +
          '<span>' + esc(appUrl) + '</span>' +
        '</footer>' +
      '</article>'
    );
  }

  /**
   * Build the printable document and open the browser print dialog directly.
   * @param {Object} recipe
   * @returns {Promise<void>}
   */
  async function printRecipePDF(recipe) {
    var printRoot = document.createElement('div');
    printRoot.className = 'print-document-root print-document-root--recipe';
    printRoot.innerHTML = buildPrintableRecipeHTML(recipe);
    document.body.appendChild(printRoot);

    try {
      var result = await PrintService.printDocument(printRoot, {
        bodyClass: 'printing-recipe',
        title: String(recipe.name || 'Ricetta') + ' — Sapori',
        imageConcurrency: 2
      });
      if (result.completion.source === 'safety-timeout') {
        Utils.showToast(
          'La stampa non ha comunicato la chiusura: l’app è stata ripristinata in sicurezza.',
          'warning'
        );
      }
    } catch (error) {
      console.error('Errore durante la stampa della ricetta:', error);
      Utils.showToast('Impossibile preparare la stampa', 'error');
    }
  }

  function hideModal() {
    var overlay = document.getElementById('modal-overlay');
    overlay.classList.add('hidden');
    overlay.innerHTML = '';
    overlay._onConfirm = null;
  }

  /* ──────────────────── PUBLIC API ──────────────────── */

  return {
    renderHome: renderHome,
    renderCreate: renderCreate,
    renderDetail: renderDetail,
    renderFavorites: renderFavorites,
    renderSettings: renderSettings,
    renderPantry: renderPantry,
    ingredientRowsHTML: ingredientRowsHTML,
    stepRowsHTML: stepRowsHTML,
    showCookingModal: showCookingModal,
    showConfirmModal: showConfirmModal,
    showImportPreviewModal: showImportPreviewModal,
    buildPrintableRecipeHTML: buildPrintableRecipeHTML,
    printRecipePDF: printRecipePDF,
    hideModal: hideModal
  };

})();
